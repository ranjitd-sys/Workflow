import type { WorkflowActionId } from '../contracts/workflow';
import { json, isRecord, readJson } from './http';
import { BrevoApiError, sendTransactionalEmail } from './email/brevo';
import { getBrevoConfig } from './email/config';
import { enqueueWorkflowAction, getWorkflowJob } from './runtime';

const WORKFLOW_ACTIONS = new Set<WorkflowActionId>(['send_email', 'schedule_email']);

function parseActionId(value: unknown): WorkflowActionId | null {
  return typeof value === 'string' && WORKFLOW_ACTIONS.has(value as WorkflowActionId)
    ? (value as WorkflowActionId)
    : null;
}

function parseParameters(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;

  const parameters: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw !== 'string') return null;
    parameters[key] = raw;
  }
  return parameters;
}

async function handleEnqueue(request: Request): Promise<Response> {
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  if (!isRecord(parsed.body)) {
    return json({ error: 'Request body must be a JSON object.' }, 400);
  }

  const actionId = parseActionId(parsed.body.actionId);
  if (!actionId) {
    return json({ error: 'actionId must be "send_email" or "schedule_email".' }, 400);
  }

  const parameters = parseParameters(parsed.body.parameters);
  if (!parameters) {
    return json({ error: 'parameters must be an object of string values.' }, 400);
  }

  try {
    const job = enqueueWorkflowAction({
      actionId,
      parameters,
      sessionId:
        typeof parsed.body.sessionId === 'string' ? parsed.body.sessionId : undefined,
      sourceEventId:
        typeof parsed.body.sourceEventId === 'string'
          ? parsed.body.sourceEventId
          : undefined,
    });

    return json(
      {
        eventId: job.eventId,
        actionId: job.actionId,
        status: job.status,
      },
      202,
    );
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Failed to enqueue workflow action.' },
      500,
    );
  }
}

function handleStatus(eventId: string | undefined): Response {
  if (!eventId) {
    return json({ error: 'eventId is required.' }, 400);
  }

  const job = getWorkflowJob(eventId);
  if (!job) {
    return json({ error: 'Workflow job not found.' }, 404);
  }

  return json(job);
}

async function handleDirectEmail(request: Request): Promise<Response> {
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  if (!isRecord(parsed.body)) {
    return json({ error: 'Request body must be a JSON object.' }, 400);
  }

  const { to, subject, body } = parsed.body;
  if (typeof to !== 'string' || typeof subject !== 'string' || typeof body !== 'string') {
    return json({ error: 'Body must include to, subject, and body strings.' }, 400);
  }

  try {
    const result = await sendTransactionalEmail({ to, subject, body }, getBrevoConfig());
    return json({ status: 'sent', messageId: result.messageId });
  } catch (error) {
    if (error instanceof BrevoApiError) {
      return json({ error: error.message }, error.status);
    }
    return json(
      { error: error instanceof Error ? error.message : 'Email send failed.' },
      500,
    );
  }
}

export function createWorkflowService() {
  return Bun.serve({
    hostname: process.env.HOST ?? '127.0.0.1',
    port: Number(process.env.PORT ?? 3002),
    routes: {
      '/health': {
        GET: () => Response.json({ ok: true, service: 'workflow' }),
      },
      '/internal/workflow/events': {
        POST: handleEnqueue,
      },
      '/internal/workflow/events/:eventId': {
        GET: (request) => {
          const eventId = new URL(request.url).pathname.split('/').filter(Boolean).at(-1);
          return handleStatus(eventId);
        },
      },
      '/internal/email': {
        POST: handleDirectEmail,
      },
    },
    fetch() {
      return Response.json({ error: 'Not found.' }, { status: 404 });
    },
  });
}

if (import.meta.main) {
  const server = createWorkflowService();
  console.log(`Workflow service listening on ${server.url}`);
}
