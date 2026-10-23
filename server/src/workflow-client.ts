import type {
  WorkflowActionId,
  WorkflowJob,
  WorkflowJobStatus,
} from '@workflow-execution/workflow';

export class WorkflowServiceError extends Error {
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = 'WorkflowServiceError';
    this.status = status;
  }
}

export interface EnqueuedWorkflowJob {
  eventId: string;
  actionId: WorkflowActionId;
  status: WorkflowJobStatus;
}

function serviceUrl(): string {
  return (process.env.WORKFLOW_SERVICE_URL ?? 'http://127.0.0.1:3002').replace(/\/$/, '');
}

async function requestJson(path: string, init: RequestInit): Promise<unknown> {
  let response: Response;

  try {
    response = await fetch(`${serviceUrl()}${path}`, {
      ...init,
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new WorkflowServiceError('Workflow service unavailable.', 502);
  }

  const payload = (await response.json().catch(() => ({}))) as {
    error?: unknown;
    [key: string]: unknown;
  };

  if (!response.ok) {
    const message =
      typeof payload.error === 'string'
        ? payload.error
        : `Workflow service returned HTTP ${response.status}.`;
    throw new WorkflowServiceError(message, response.status);
  }

  return payload;
}

export async function enqueueWorkflowAction(input: {
  actionId: WorkflowActionId;
  parameters: Record<string, string>;
  sessionId?: string;
  sourceEventId?: string;
}): Promise<EnqueuedWorkflowJob> {
  const payload = (await requestJson('/internal/workflow/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })) as Partial<EnqueuedWorkflowJob>;

  if (
    typeof payload.eventId !== 'string' ||
    typeof payload.actionId !== 'string' ||
    typeof payload.status !== 'string'
  ) {
    throw new WorkflowServiceError('Workflow service returned an invalid enqueue response.');
  }

  return {
    eventId: payload.eventId,
    actionId: payload.actionId as WorkflowActionId,
    status: payload.status as WorkflowJobStatus,
  };
}

export async function getWorkflowJob(eventId: string): Promise<WorkflowJob | undefined> {
  try {
    return (await requestJson(
      `/internal/workflow/events/${encodeURIComponent(eventId)}`,
      { method: 'GET', headers: { Accept: 'application/json' } },
    )) as WorkflowJob;
  } catch (error) {
    if (error instanceof WorkflowServiceError && error.status === 404) {
      return undefined;
    }
    throw error;
  }
}

export async function sendDirectEmail(input: {
  to: string;
  subject: string;
  body: string;
}): Promise<{ messageId: string }> {
  const payload = (await requestJson('/internal/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })) as { messageId?: unknown };

  if (typeof payload.messageId !== 'string') {
    throw new WorkflowServiceError('Workflow service did not return a message ID.');
  }

  return { messageId: payload.messageId };
}
