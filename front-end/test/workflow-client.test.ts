import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  enqueueWorkflowAction,
  waitForWorkflowJob,
} from '../src/lib/workflow';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('workflow client helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('enqueues a workflow action', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ eventId: 'event-1', status: 'queued' }, 202),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await enqueueWorkflowAction({
      actionId: 'send_email',
      parameters: {
        to: 'john@acme.com',
        subject: 'Invoice',
        body: 'Please find the invoice attached.',
      },
      sessionId: 'session-1',
    });

    expect(result).toEqual({ ok: true, eventId: 'event-1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/workflow/events');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      actionId: 'send_email',
      sessionId: 'session-1',
    });
  });

  it('returns enqueue errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'Missing parameters.' }, 400)),
    );

    await expect(
      enqueueWorkflowAction({ actionId: 'send_email', parameters: {} }),
    ).resolves.toEqual({ ok: false, error: 'Missing parameters.' });
  });

  it('polls until a job succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          eventId: 'event-1',
          actionId: 'send_email',
          status: 'succeeded',
          parameters: {},
          createdAt: '2026-10-23T09:00:00.000Z',
          messageId: 'msg-1',
        }),
      ),
    );

    await expect(
      waitForWorkflowJob('event-1', { intervalMs: 1 }),
    ).resolves.toEqual({ ok: true, messageId: 'msg-1' });
  });

  it('returns workflow failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          eventId: 'event-1',
          actionId: 'send_email',
          status: 'failed',
          parameters: {},
          createdAt: '2026-10-23T09:00:00.000Z',
          error: 'Brevo unavailable',
        }),
      ),
    );

    await expect(
      waitForWorkflowJob('event-1', { intervalMs: 1 }),
    ).resolves.toEqual({ ok: false, error: 'Brevo unavailable' });
  });

  it('reports a missing job', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'Workflow job not found.' }, 404)),
    );

    await expect(
      waitForWorkflowJob('event-1', { intervalMs: 1 }),
    ).resolves.toEqual({
      ok: false,
      error: 'Workflow job not found. The server may have restarted.',
    });
  });

  it('times out while a job stays queued', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          eventId: 'event-1',
          actionId: 'send_email',
          status: 'queued',
          parameters: {},
          createdAt: '2026-10-23T09:00:00.000Z',
        }),
      ),
    );

    await expect(
      waitForWorkflowJob('event-1', { intervalMs: 5, timeoutMs: 20 }),
    ).resolves.toEqual({
      ok: false,
      error: 'Timed out waiting for workflow action.',
    });
  });
});
