import { fromPromise } from 'xstate';
import type { WorkflowActionRequestedEvent } from '@workflow-execution/workflow';
import {
  sendTransactionalEmail,
  type BrevoConfig,
} from '../../email/brevo';

export interface SendEmailActorInput {
  event: WorkflowActionRequestedEvent;
  brevo: BrevoConfig;
}

export const sendEmailActor = fromPromise(
  async ({ input }: { input: SendEmailActorInput }) => {
    const { to, subject, body } = input.event.parameters;

    if (!to || !subject || !body) {
      throw new Error('send_email requires to, subject, and body.');
    }

    return sendTransactionalEmail({ to, subject, body }, input.brevo);
  },
);
