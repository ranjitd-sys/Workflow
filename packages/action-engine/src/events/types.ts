import { z } from 'zod';
import { parameterSchema } from '../types';

export const CHAT_ACTION_IDENTIFIED_EVENT_TYPE = 'chat.action.identified';

export const actionIdentifiedEventSchema = z.object({
  id: z.string().min(1),
  type: z.literal(CHAT_ACTION_IDENTIFIED_EVENT_TYPE),
  version: z.literal(1),
  occurredAt: z.string().min(1),
  sessionId: z.string().min(1),
  messageId: z.string().min(1).optional(),
  source: z.literal('chat'),
  action: z.object({
    identifier: z.string().min(1).nullable(),
    status: z.enum(['clear', 'ambiguous', 'unknown']),
    alternatives: z.array(z.string().min(1)),
    summary: z.string().min(1),
  }),
  parameters: z.array(parameterSchema),
  missing: z.array(z.string()),
  assumptions: z.array(z.string()),
  ambiguities: z.array(z.string()),
});

export type ActionIdentifiedEvent = z.infer<typeof actionIdentifiedEventSchema>;

export interface ActionEventSink {
  emit(event: ActionIdentifiedEvent): Promise<void>;
}
