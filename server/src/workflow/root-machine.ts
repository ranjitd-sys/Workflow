import { assign, fromCallback, raise, setup } from 'xstate';
import type { WorkflowActionRequestedEvent, WorkflowQueue } from '@workflow-execution/workflow';
import { sendEmailActor } from './actors/send-email.actor';
import { scheduleEmailActor } from './actors/schedule-email.actor';
import type { BrevoConfig } from '../email/brevo';

export interface WorkflowMachineDependencies {
  queue: WorkflowQueue;
  brevo: BrevoConfig;
}

export interface WorkflowMachineContext {
  current: WorkflowActionRequestedEvent | null;
  result: { messageId?: string } | null;
  error?: string;
}

export type WorkflowMachineEvent = { type: 'QUEUE_WAKE' };

function now(): string {
  return new Date().toISOString();
}

export function createWorkflowMachine(dependencies: WorkflowMachineDependencies) {
  const { queue, brevo } = dependencies;

  const queueListener = fromCallback(({ sendBack }) => {
    const unsubscribe = queue.subscribe(() => {
      sendBack({ type: 'QUEUE_WAKE' });
    });
    sendBack({ type: 'QUEUE_WAKE' });
    return unsubscribe;
  });

  return setup({
    types: {
      context: {} as WorkflowMachineContext,
      events: {} as WorkflowMachineEvent,
    },
    actors: {
      queueListener,
      sendEmail: sendEmailActor,
      scheduleEmail: scheduleEmailActor,
    },
    guards: {
      nextIsSendEmail: () => queue.peek()?.actionId === 'send_email',
      nextIsScheduleEmail: () => queue.peek()?.actionId === 'schedule_email',
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
          QUEUE_WAKE: [
            {
              guard: 'nextIsSendEmail',
              target: 'send_email',
              actions: 'dequeueNext',
            },
            {
              guard: 'nextIsScheduleEmail',
              target: 'schedule_email',
              actions: 'dequeueNext',
            },
          ],
        },
      },
      send_email: {
        invoke: {
          src: 'sendEmail',
          input: ({ context }) => ({
            event: context.current as WorkflowActionRequestedEvent,
            brevo,
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
      schedule_email: {
        invoke: {
          src: 'scheduleEmail',
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
