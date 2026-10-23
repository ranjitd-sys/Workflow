import type { WorkflowActionId, WorkflowActionRequestedEvent } from '../../contracts/workflow';
import type { BrevoConfig } from '../email/brevo';
import { scheduleEmailActor } from './schedule-email.actor';
import { sendEmailActor } from './send-email.actor';

export type WorkflowActor = (
  event: WorkflowActionRequestedEvent,
) => Promise<{ messageId?: string }>;

export type WorkflowActorRegistry = Record<WorkflowActionId, WorkflowActor>;

export function createWorkflowActors({
  brevo,
}: {
  brevo: BrevoConfig;
}): WorkflowActorRegistry {
  return {
    send_email: (event) => sendEmailActor(event, brevo),
    schedule_email: scheduleEmailActor,
  };
}
