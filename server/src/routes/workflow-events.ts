import type { WorkflowActionId } from '@workflow-execution/workflow';
import { APP_ACTIONS } from '../actions/definitions';
import { isRecord, json, readJson } from '../http/json';
import { enqueueWorkflowAction, WorkflowServiceError } from '../workflow-client';

const WORKFLOW_ACTIONS = new Set<WorkflowActionId>(['send_email', 'schedule_email']);

function parseActionId(value: unknown): WorkflowActionId | null {
  return typeof value === 'string' && WORKFLOW_ACTIONS.has(value as WorkflowActionId)
    ? (value as WorkflowActionId)
    : null;
}

function parseParameters(
  value: unknown,
  actionId: WorkflowActionId,
): Record<string, string> | null {
  if (!isRecord(value)) return null;

  const definition = APP_ACTIONS.find((action) => action.id === actionId);
  if (!definition) return null;

  const parameters: Record<string, string> = {};
  for (const parameter of definition.parameters ?? []) {
    const raw = value[parameter.name];
    if (typeof raw === 'string' && raw.trim()) {
      parameters[parameter.name] = raw.trim();
    } else if (parameter.required) {
      return null;
    }
  }

  return parameters;
}

export async function handleWorkflowEvents(request: Request): Promise<Response> {
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;

  if (!isRecord(parsed.body)) {
    return json({ error: 'Request body must be a JSON object.' }, 400);
  }

  const actionId = parseActionId(parsed.body.actionId);
  if (!actionId) {
    return json({ error: 'actionId must be "send_email" or "schedule_email".' }, 400);
  }

  const parameters = parseParameters(parsed.body.parameters, actionId);
  if (!parameters) {
    return json({ error: `Missing required parameters for ${actionId}.` }, 400);
  }

  try {
    const job = await enqueueWorkflowAction({
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
    if (error instanceof WorkflowServiceError) {
      return json({ error: error.message }, error.status);
    }
    return json(
      { error: error instanceof Error ? error.message : 'Failed to enqueue workflow action.' },
      502,
    );
  }
}
