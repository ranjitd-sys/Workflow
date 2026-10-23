import { randomUUID } from 'node:crypto';
import { createActor, type AnyActorRef } from 'xstate';
import {
  WORKFLOW_ACTION_REQUESTED_EVENT_TYPE,
  type WorkflowActionId,
  type WorkflowActionRequestedEvent,
  type WorkflowJob,
} from '@workflow-execution/workflow';
import { getBrevoConfig } from '../email/config';
import { InMemoryWorkflowQueue } from './queue/in-memory-queue';
import { createWorkflowMachine } from './root-machine';

interface WorkflowRuntime {
  queue: InMemoryWorkflowQueue;
  actor: AnyActorRef;
}

interface WorkflowGlobal {
  __workflowRuntime?: WorkflowRuntime;
}

export interface EnqueueWorkflowActionInput {
  actionId: WorkflowActionId;
  parameters: Record<string, string>;
  sessionId?: string;
  sourceEventId?: string;
}

const runtimeGlobal = globalThis as typeof globalThis & WorkflowGlobal;

function createRuntime(): WorkflowRuntime {
  const queue = new InMemoryWorkflowQueue();
  const actor = createActor(
    createWorkflowMachine({
      queue,
      brevo: getBrevoConfig(),
    }),
  );

  actor.start();

  return { queue, actor };
}

export function getWorkflowRuntime(): WorkflowRuntime {
  runtimeGlobal.__workflowRuntime ??= createRuntime();
  return runtimeGlobal.__workflowRuntime;
}

export function enqueueWorkflowAction(input: EnqueueWorkflowActionInput): WorkflowJob {
  const event: WorkflowActionRequestedEvent = {
    id: randomUUID(),
    type: WORKFLOW_ACTION_REQUESTED_EVENT_TYPE,
    version: 1,
    occurredAt: new Date().toISOString(),
    actionId: input.actionId,
    parameters: { ...input.parameters },
    source: 'chat',
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.sourceEventId ? { sourceEventId: input.sourceEventId } : {}),
  };

  return getWorkflowRuntime().queue.enqueue(event);
}

export function getWorkflowJob(eventId: string): WorkflowJob | undefined {
  return runtimeGlobal.__workflowRuntime?.queue.getJob(eventId);
}
