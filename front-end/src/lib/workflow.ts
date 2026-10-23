import type { WorkflowActionId, WorkflowJob } from '@workflow-execution/workflow';

export interface EnqueueWorkflowActionInput {
  actionId: WorkflowActionId;
  parameters: Record<string, string>;
  sessionId?: string;
  sourceEventId?: string;
}

export type EnqueueWorkflowActionResult =
  | { ok: true; eventId: string }
  | { ok: false; error: string };

export type WorkflowExecutionResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string };

export interface WaitForWorkflowJobOptions {
  intervalMs?: number;
  timeoutMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export async function enqueueWorkflowAction(
  input: EnqueueWorkflowActionInput,
): Promise<EnqueueWorkflowActionResult> {
  try {
    const response = await fetch('/api/workflow/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      eventId?: unknown;
      error?: unknown;
    };

    if (!response.ok) {
      return {
        ok: false,
        error:
          typeof payload.error === 'string'
            ? payload.error
            : `HTTP ${response.status}`,
      };
    }

    if (typeof payload.eventId !== 'string') {
      return { ok: false, error: 'Workflow API did not return an event ID.' };
    }

    return { ok: true, eventId: payload.eventId };
  } catch (error) {
    return { ok: false, error: errorMessage(error, 'Failed to enqueue workflow action.') };
  }
}

export async function waitForWorkflowJob(
  eventId: string,
  options: WaitForWorkflowJobOptions = {},
): Promise<WorkflowExecutionResult> {
  const intervalMs = options.intervalMs ?? 750;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`/api/workflow/events/${encodeURIComponent(eventId)}`, {
        headers: { Accept: 'application/json' },
      });

      if (response.status === 404) {
        return {
          ok: false,
          error: 'Workflow job not found. The server may have restarted.',
        };
      }

      if (!response.ok) {
        return { ok: false, error: `HTTP ${response.status}` };
      }

      const job = (await response.json()) as WorkflowJob;
      if (job.status === 'failed') {
        return { ok: false, error: job.error ?? 'Workflow action failed.' };
      }

      if (job.status === 'succeeded') {
        if (!job.messageId) {
          return { ok: false, error: 'Workflow succeeded without a message ID.' };
        }
        return { ok: true, messageId: job.messageId };
      }
    } catch (error) {
      return { ok: false, error: errorMessage(error, 'Failed to read workflow status.') };
    }

    await sleep(intervalMs);
  }

  return { ok: false, error: 'Timed out waiting for workflow action.' };
}
