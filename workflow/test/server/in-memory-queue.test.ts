import { describe, expect, it } from 'vitest';
import { InMemoryWorkflowQueue } from '../../src/server/queue/in-memory-queue';
import {
  WORKFLOW_ACTION_REQUESTED_EVENT_TYPE,
  type WorkflowActionId,
  type WorkflowActionRequestedEvent,
} from '../../src/contracts/workflow';

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
    },
    source: 'chat',
  };
}

describe('InMemoryWorkflowQueue', () => {
  it('processes events in FIFO order', () => {
    const queue = new InMemoryWorkflowQueue();
    queue.enqueue(makeEvent('e1'));
    queue.enqueue(makeEvent('e2'));

    expect(queue.size).toBe(2);
    expect(queue.peek()?.id).toBe('e1');
    expect(queue.dequeue()?.id).toBe('e1');
    expect(queue.dequeue()?.id).toBe('e2');
    expect(queue.size).toBe(0);
  });

  it('creates a queued job and notifies subscribers', () => {
    const queue = new InMemoryWorkflowQueue();
    const seen: string[] = [];
    const unsubscribe = queue.subscribe((event) => {
      seen.push(event.id);
    });

    const job = queue.enqueue(makeEvent('e1'));

    expect(job.status).toBe('queued');
    expect(job.actionId).toBe('send_email');
    expect(seen).toEqual(['e1']);

    unsubscribe();
    queue.enqueue(makeEvent('e2'));
    expect(seen).toEqual(['e1']);
  });

  it('deduplicates events by ID', () => {
    const queue = new InMemoryWorkflowQueue();
    const first = queue.enqueue(makeEvent('e1'));
    const second = queue.enqueue(makeEvent('e1'));

    expect(second).toEqual(first);
    expect(queue.size).toBe(1);
  });

  it('updates job status and result', () => {
    const queue = new InMemoryWorkflowQueue();
    queue.enqueue(makeEvent('e1'));

    queue.updateJob('e1', {
      status: 'running',
      startedAt: '2026-10-23T09:00:01.000Z',
    });
    queue.updateJob('e1', {
      status: 'succeeded',
      finishedAt: '2026-10-23T09:00:02.000Z',
      messageId: 'msg-1',
    });

    expect(queue.getJob('e1')).toMatchObject({
      status: 'succeeded',
      startedAt: '2026-10-23T09:00:01.000Z',
      finishedAt: '2026-10-23T09:00:02.000Z',
      messageId: 'msg-1',
    });
  });
});
