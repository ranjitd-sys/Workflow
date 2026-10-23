export type WorkflowActionId = 'send_email' | 'schedule_email';

export const WORKFLOW_ACTION_REQUESTED_EVENT_TYPE = 'workflow.action.requested' as const;

export interface WorkflowActionRequestedEvent {
  id: string;
  type: typeof WORKFLOW_ACTION_REQUESTED_EVENT_TYPE;
  version: 1;
  occurredAt: string;
  actionId: WorkflowActionId;
  parameters: Record<string, string>;
  sessionId?: string;
  source: 'chat';
  sourceEventId?: string;
}

export type WorkflowJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface WorkflowJob {
  eventId: string;
  actionId: WorkflowActionId;
  status: WorkflowJobStatus;
  parameters: Record<string, string>;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  messageId?: string;
  error?: string;
}

export type WorkflowJobPatch = Partial<
  Pick<WorkflowJob, 'status' | 'startedAt' | 'finishedAt' | 'messageId' | 'error'>
>;

export type WorkflowQueueListener = (event: WorkflowActionRequestedEvent) => void;

export interface WorkflowQueue {
  enqueue(event: WorkflowActionRequestedEvent): WorkflowJob;
  peek(): WorkflowActionRequestedEvent | undefined;
  dequeue(): WorkflowActionRequestedEvent | undefined;
  subscribe(listener: WorkflowQueueListener): () => void;
  getJob(eventId: string): WorkflowJob | undefined;
  updateJob(eventId: string, patch: WorkflowJobPatch): WorkflowJob | undefined;
  readonly size: number;
}
