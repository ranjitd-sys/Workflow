import { createActor, waitFor } from 'xstate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WORKFLOW_ACTION_REQUESTED_EVENT_TYPE,
  type WorkflowActionId,
  type WorkflowActionRequestedEvent,
} from '@workflow-execution/workflow';
import type { BrevoConfig } from '../src/email/brevo';
import { InMemoryWorkflowQueue } from '../src/workflow/queue/in-memory-queue';
import { createWorkflowMachine } from '../src/workflow/root-machine';

const brevo: BrevoConfig = {
  apiKey: 'test-key',
  senderEmail: 'sender@example.com',
  senderName: 'Sender',
};

function makeEvent(
  id: string,
  actionId: WorkflowActionId = 'send_email',
): WorkflowActionRequestedEvent {
  return {
    id,
    type: WORKFLOW_ACTION_REQUESTED_EVENT_TYPE,
    version: 1,
    occurredAt: '2026-10-23T09:00:00.000Z',
    actionId,
    parameters: {
      to: 'john@acme.com',
      subject: 'Invoice',
      body: 'Please find the invoice attached.',
      ...(actionId === 'schedule_email'
        ? { send_at: '2026-10-24T09:00:00.000Z' }
        : {}),
    },
    source: 'chat',
  };
}

function brevoResponse(messageId: string) {
  return {
    ok: true,
    status: 201,
    json: async () => ({ messageId }),
  };
}

describe('workflow machine', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('routes send_email to Brevo and records success', async () => {
    const queue = new InMemoryWorkflowQueue();
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      brevoResponse('msg-1'),
    );
    vi.stubGlobal('fetch', fetchMock);

    const actor = createActor(createWorkflowMachine({ queue, brevo }));
    actor.start();

    queue.enqueue(makeEvent('e1'));

    await waitFor(actor, () => queue.getJob('e1')?.status === 'succeeded', {
      timeout: 1_000,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      to: [{ email: 'john@acme.com' }],
      subject: 'Invoice',
      textContent: 'Please find the invoice attached.',
    });
    expect(queue.getJob('e1')).toMatchObject({
      status: 'succeeded',
      messageId: 'msg-1',
    });

    actor.stop();
  });

  it('records send failures', async () => {
    const queue = new InMemoryWorkflowQueue();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({ message: 'Brevo unavailable' }),
      })),
    );

    const actor = createActor(createWorkflowMachine({ queue, brevo }));
    actor.start();

    queue.enqueue(makeEvent('e1'));

    await waitFor(actor, () => queue.getJob('e1')?.status === 'failed', {
      timeout: 1_000,
    });

    expect(queue.getJob('e1')?.error).toBe('Brevo unavailable');
    actor.stop();
  });

  it('routes schedule_email to the placeholder actor and fails', async () => {
    const queue = new InMemoryWorkflowQueue();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const actor = createActor(createWorkflowMachine({ queue, brevo }));
    actor.start();

    queue.enqueue(makeEvent('s1', 'schedule_email'));

    await waitFor(actor, () => queue.getJob('s1')?.status === 'failed', {
      timeout: 1_000,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(queue.getJob('s1')?.error).toContain('not implemented');
    actor.stop();
  });

  it('processes queued jobs serially', async () => {
    const queue = new InMemoryWorkflowQueue();
    const pending: Array<(messageId: string) => void> = [];
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          pending.push((messageId) => resolve(brevoResponse(messageId)));
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const actor = createActor(createWorkflowMachine({ queue, brevo }));
    actor.start();

    queue.enqueue(makeEvent('e1'));
    queue.enqueue(makeEvent('e2'));

    await waitFor(actor, () => queue.getJob('e1')?.status === 'running', {
      timeout: 1_000,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    pending[0]('msg-1');

    await waitFor(actor, () => queue.getJob('e2')?.status === 'running', {
      timeout: 1_000,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    pending[1]('msg-2');

    await waitFor(
      actor,
      () =>
        queue.getJob('e1')?.status === 'succeeded' &&
        queue.getJob('e2')?.status === 'succeeded',
      { timeout: 1_000 },
    );

    expect(queue.getJob('e1')?.messageId).toBe('msg-1');
    expect(queue.getJob('e2')?.messageId).toBe('msg-2');
    actor.stop();
  });
});
