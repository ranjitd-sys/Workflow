import { createActor, waitFor } from 'xstate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WORKFLOW_ACTION_REQUESTED_EVENT_TYPE,
  type WorkflowActionId,
  type WorkflowActionRequestedEvent,
} from '../../src/contracts/workflow';
import type { WorkflowActorRegistry } from '../../src/server/actors';
import { createMainWorkflowMachine } from '../../src/server/main-machine';
import { TestWorkflowQueue } from './test-queue';

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

describe('main workflow machine', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('routes send_email to the actor and records success', async () => {
    const queue = new TestWorkflowQueue();
    const sendEmail = vi.fn(async (_event: WorkflowActionRequestedEvent) => ({
      messageId: 'msg-1',
    }));
    const actors: WorkflowActorRegistry = {
      send_email: async (event) => sendEmail(event),
      schedule_email: async () => {
        throw new Error('schedule_email is not implemented yet.');
      },
    };
    const actor = createActor(createMainWorkflowMachine({ queue, actors }));
    actor.start();

    queue.enqueue(makeEvent('e1'));

    await waitFor(actor, () => queue.getJob('e1')?.status === 'succeeded', {
      timeout: 1_000,
    });

    expect(sendEmail).toHaveBeenCalled();
    expect(sendEmail.mock.calls[0]?.[0]).toMatchObject({
      id: 'e1',
      actionId: 'send_email',
    });
    expect(queue.getJob('e1')).toMatchObject({
      status: 'succeeded',
      messageId: 'msg-1',
    });

    actor.stop();
  });

  it('records actor failures', async () => {
    const queue = new TestWorkflowQueue();
    const actors: WorkflowActorRegistry = {
      send_email: async () => {
        throw new Error('Brevo unavailable');
      },
      schedule_email: async () => {
        throw new Error('schedule_email is not implemented yet.');
      },
    };
    const actor = createActor(createMainWorkflowMachine({ queue, actors }));
    actor.start();

    queue.enqueue(makeEvent('e1'));

    await waitFor(actor, () => queue.getJob('e1')?.status === 'failed', {
      timeout: 1_000,
    });

    expect(queue.getJob('e1')?.error).toBe('Brevo unavailable');
    actor.stop();
  });

  it('routes schedule_email to the placeholder actor and fails', async () => {
    const queue = new TestWorkflowQueue();
    const sendEmail = vi.fn();
    const actors: WorkflowActorRegistry = {
      send_email: async (event) => sendEmail(event),
      schedule_email: async () => {
        throw new Error('schedule_email is not implemented yet.');
      },
    };
    const actor = createActor(createMainWorkflowMachine({ queue, actors }));
    actor.start();

    queue.enqueue(makeEvent('s1', 'schedule_email'));

    await waitFor(actor, () => queue.getJob('s1')?.status === 'failed', {
      timeout: 1_000,
    });

    expect(sendEmail).not.toHaveBeenCalled();
    expect(queue.getJob('s1')?.error).toContain('not implemented');
    actor.stop();
  });

  it('processes queued jobs serially', async () => {
    const queue = new TestWorkflowQueue();
    const pending: Array<(messageId: string) => void> = [];
    const sendEmail = vi.fn(
      (_event: WorkflowActionRequestedEvent) =>
        new Promise<{ messageId: string }>((resolve) => {
          pending.push((messageId) => resolve({ messageId }));
        }),
    );
    const actors: WorkflowActorRegistry = {
      send_email: async (event) => sendEmail(event),
      schedule_email: async () => {
        throw new Error('schedule_email is not implemented yet.');
      },
    };
    const actor = createActor(createMainWorkflowMachine({ queue, actors }));
    actor.start();

    queue.enqueue(makeEvent('e1'));
    queue.enqueue(makeEvent('e2'));

    await waitFor(actor, () => queue.getJob('e1')?.status === 'running', {
      timeout: 1_000,
    });
    expect(sendEmail).toHaveBeenCalledTimes(1);

    pending[0]('msg-1');

    await waitFor(actor, () => queue.getJob('e2')?.status === 'running', {
      timeout: 1_000,
    });
    expect(sendEmail).toHaveBeenCalledTimes(2);

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
