import { assign, fromCallback, fromPromise, raise, setup } from 'xstate';
import type { WorkflowActionRequestedEvent, WorkflowQueue } from '../contracts/workflow';
import type { WorkflowActorRegistry } from './actors';

export interface MainMachineContext {
  current: WorkflowActionRequestedEvent | null;
  result: { messageId?: string } | null;
  error?: string;
}

export type MainMachineEvent = { type: 'QUEUE_WAKE' };

export interface MainWorkflowMachineDependencies {
  queue: WorkflowQueue;
  actors: WorkflowActorRegistry;
}

function now(): string {
  return new Date().toISOString();
}

const runActor = fromPromise(
  async ({
    input,
  }: {
    input: {
      event: WorkflowActionRequestedEvent;
      actors: WorkflowActorRegistry;
    };
  }) => {
    const actor = input.actors[input.event.actionId];
    if (!actor) {
      throw new Error(`No workflow actor for ${input.event.actionId}.`);
    }
    return actor(input.event);
  },
);

export function createMainWorkflowMachine(dependencies: MainWorkflowMachineDependencies) {
  const { queue, actors } = dependencies;

  const queueListener = fromCallback(({ sendBack }) => {
    const unsubscribe = queue.subscribe(() => {
      sendBack({ type: 'QUEUE_WAKE' });
    });
    sendBack({ type: 'QUEUE_WAKE' });
    return unsubscribe;
  });

  return setup({
    types: {
      context: {} as MainMachineContext,
      events: {} as MainMachineEvent,
    },
    actors: {
      queueListener,
      runActor,
    },
    guards: {
      hasQueuedJob: () => queue.peek() !== undefined,
    },
    actions: {
      dequeueNext: assign(() => {
        const event = queue.dequeue();
        if (!event) return {};

        queue.updateJob(event.id, {
          status: 'running',
          startedAt: now(),
        });

        return {
          current: event,
          result: null,
          error: undefined,
        };
      }),
      storeSuccess: assign(({ context, event }) => {
        const output = (event as { output?: { messageId?: string } }).output;
        if (context.current) {
          queue.updateJob(context.current.id, {
            status: 'succeeded',
            finishedAt: now(),
            messageId: output?.messageId,
          });
        }

        return {
          result: output ?? null,
          error: undefined,
        };
      }),
      storeError: assign(({ context, event }) => {
        const error = (event as { error?: unknown }).error;
        const message =
          error instanceof Error
            ? error.message
            : typeof error === 'string'
              ? error
              : 'Workflow action failed.';

        if (context.current) {
          queue.updateJob(context.current.id, {
            status: 'failed',
            finishedAt: now(),
            error: message,
          });
        }

        return {
          result: null,
          error: message,
        };
      }),
      clearCurrent: assign(() => ({
        current: null,
        result: null,
        error: undefined,
      })),
    },
  }).createMachine({
    id: 'workflow',
    initial: 'idle',
    context: {
      current: null,
      result: null,
    },
    invoke: {
      id: 'queueListener',
      src: 'queueListener',
    },
    states: {
      idle: {
        entry: raise({ type: 'QUEUE_WAKE' }),
        on: {
          QUEUE_WAKE: {
            guard: 'hasQueuedJob',
            target: 'processing',
            actions: 'dequeueNext',
          },
        },
      },
      processing: {
        invoke: {
          src: 'runActor',
          input: ({ context }: { context: MainMachineContext }) => ({
            event: context.current as WorkflowActionRequestedEvent,
            actors,
          }),
          onDone: {
            target: 'completed',
            actions: 'storeSuccess',
          },
          onError: {
            target: 'failed',
            actions: 'storeError',
          },
        },
      },
      completed: {
        entry: 'clearCurrent',
        always: 'idle',
      },
      failed: {
        entry: 'clearCurrent',
        always: 'idle',
      },
    },
  });
}
