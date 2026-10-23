import type {
  WorkflowActionRequestedEvent,
  WorkflowJob,
  WorkflowJobPatch,
  WorkflowQueue,
  WorkflowQueueListener,
} from '@workflow-execution/workflow';

export class InMemoryWorkflowQueue implements WorkflowQueue {
  private readonly events: WorkflowActionRequestedEvent[] = [];
  private readonly jobs = new Map<string, WorkflowJob>();
  private readonly listeners = new Set<WorkflowQueueListener>();

  get size(): number {
    return this.events.length;
  }

  enqueue(event: WorkflowActionRequestedEvent): WorkflowJob {
    const existing = this.jobs.get(event.id);
    if (existing) return existing;

    const job: WorkflowJob = {
      eventId: event.id,
      actionId: event.actionId,
      status: 'queued',
      parameters: { ...event.parameters },
      createdAt: event.occurredAt,
    };

    this.events.push(event);
    this.jobs.set(event.id, job);

    for (const listener of this.listeners) {
      listener(event);
    }

    return job;
  }

  peek(): WorkflowActionRequestedEvent | undefined {
    return this.events[0];
  }

  dequeue(): WorkflowActionRequestedEvent | undefined {
    return this.events.shift();
  }

  subscribe(listener: WorkflowQueueListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getJob(eventId: string): WorkflowJob | undefined {
    return this.jobs.get(eventId);
  }

  updateJob(eventId: string, patch: WorkflowJobPatch): WorkflowJob | undefined {
    const existing = this.jobs.get(eventId);
    if (!existing) return undefined;

    const updated = { ...existing, ...patch };
    this.jobs.set(eventId, updated);
    return updated;
  }
}
