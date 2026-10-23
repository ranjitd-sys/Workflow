import { z } from 'zod';
import {
  URGENCY_LEVELS,
  actionItemSchema,
  entitySchema,
  intentSchema,
  parameterSchema,
  questionSchema,
} from '../types';

export const CHAT_INTENT_EVENT_TYPE = 'chat.intent.detected';

export const chatIntentEventSchema = z.object({
  id: z.string().min(1),
  type: z.literal(CHAT_INTENT_EVENT_TYPE),
  version: z.literal(1),
  occurredAt: z.string().min(1),
  sessionId: z.string().min(1),
  messageId: z.string().min(1).optional(),
  source: z.literal('chat'),
  intent: intentSchema,
  entities: z.array(entitySchema),
  parameters: z.array(parameterSchema),
  actionItems: z.array(actionItemSchema),
  questions: z.array(questionSchema),
  urgency: z.enum(URGENCY_LEVELS),
  replyRequired: z.boolean().nullable(),
  unknowns: z.array(z.string()),
  assumptions: z.array(z.string()),
  ambiguities: z.array(z.string()),
});

export type ChatIntentEvent = z.infer<typeof chatIntentEventSchema>;

/**
 * Destination for emitted intent events. Swap this implementation for a
 * webhook, message queue, or internal bus without touching the engine.
 */
export interface IntentEventSink {
  emit(event: ChatIntentEvent): Promise<void>;
}
