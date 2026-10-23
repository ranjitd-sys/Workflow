import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  enqueueWorkflowAction,
  getWorkflowJob,
  sendDirectEmail,
  WorkflowServiceError,
} from '../src/workflow-client';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('workflow client', () => {
  beforeEach(() => {
    process.env.WORKFLOW_SERVICE_URL = 'http://workflow.test';
  });

  afterEach(() => {
    delete process.env.WORKFLOW_SERVICE_URL;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('enqueues a workflow action through the workflow service', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ eventId: 'event-1', actionId: 'send_email', status: 'queued' }, 202),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await enqueueWorkflowAction({
      actionId: 'send_email',
      parameters: { to: 'john@acme.com', subject: 'Invoice', body: 'Body' },
      sessionId: 'session-1',
    });

    expect(result).toEqual({
      eventId: 'event-1',
      actionId: 'send_email',
      status: 'queued',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://workflow.test/internal/workflow/events');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      actionId: 'send_email',
      sessionId: 'session-1',
    });
  });

  it('returns undefined for a missing workflow job', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'Workflow job not found.' }, 404)),
    );

    await expect(getWorkflowJob('missing')).resolves.toBeUndefined();
  });

  it('maps workflow errors to WorkflowServiceError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'Workflow service unavailable.' }, 502)),
    );

    await expect(getWorkflowJob('event-1')).rejects.toMatchObject({
      name: 'WorkflowServiceError',
      status: 502,
      message: 'Workflow service unavailable.',
    });
  });

  it('sends a direct email through the workflow service', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ status: 'sent', messageId: 'msg-1' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      sendDirectEmail({ to: 'john@acme.com', subject: 'Invoice', body: 'Body' }),
    ).resolves.toEqual({ messageId: 'msg-1' });
    expect(fetchMock.mock.calls[0][0]).toBe('http://workflow.test/internal/email');
  });

  it('reports an unreachable workflow service', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connection refused');
      }),
    );

    await expect(getWorkflowJob('event-1')).rejects.toBeInstanceOf(WorkflowServiceError);
  });
});
