import type { WorkflowActionRequestedEvent } from '../../contracts/workflow';
import { sendTransactionalEmail, type BrevoConfig } from '../email/brevo';

export async function sendEmailActor(
  event: WorkflowActionRequestedEvent,
  brevo: BrevoConfig,
): Promise<{ messageId: string }> {
  const { to, subject, body } = event.parameters;

  if (!to || !subject || !body) {
    throw new Error('send_email requires to, subject, and body.');
  }

  return sendTransactionalEmail({ to, subject, body }, brevo);
}
