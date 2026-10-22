import { z } from 'zod';

export const INTENT_IDS = [
  'request',
  'question',
  'informational',
  'meeting',
  'follow_up',
  'complaint',
  'approval',
  'social',
  'notification',
  'marketing',
  'other',
] as const;

export type IntentId = (typeof INTENT_IDS)[number];

export const INTENT_STATUSES = ['clear', 'ambiguous', 'unknown'] as const;

export type IntentStatus = (typeof INTENT_STATUSES)[number];

export const URGENCY_LEVELS = ['low', 'normal', 'high', 'unknown'] as const;

export type Urgency = (typeof URGENCY_LEVELS)[number];

export const ENTITY_TYPES = [
  'person',
  'organization',
  'date',
  'time',
  'amount',
  'reference',
  'link',
  'location',
  'other',
] as const;

export type IntentEntityType = (typeof ENTITY_TYPES)[number];

export const ACTION_OWNERS = ['recipient', 'sender', 'third_party', 'unknown'] as const;

export type ActionOwner = (typeof ACTION_OWNERS)[number];

export interface IntentDefinition {
  /** Stable identifier the model is allowed to return. */
  id: IntentId;
  name: string;
  description: string;
  examples: string[];
  synonyms?: string[];
}

export const chatHistoryMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1),
});

export const chatIntentInputSchema = z.object({
  message: z.string().min(1),
  history: z.array(chatHistoryMessageSchema).optional(),
  sessionId: z.string().min(1).optional(),
  messageId: z.string().min(1).optional(),
  timestamp: z.string().min(1).optional(),
});

export type ChatHistoryMessage = z.infer<typeof chatHistoryMessageSchema>;
export type ChatIntentInput = z.infer<typeof chatIntentInputSchema>;

export const entitySchema = z.object({
  type: z.enum(ENTITY_TYPES),
  text: z.string().min(1),
  normalized: z.string().min(1).nullish(),
  evidence: z.string().min(1),
});

export const actionItemSchema = z.object({
  description: z.string().min(1),
  owner: z.enum(ACTION_OWNERS),
  dueDate: z.string().min(1).nullish(),
  evidence: z.string().min(1),
});

export const questionSchema = z.object({
  question: z.string().min(1),
  evidence: z.string().min(1),
});

export const intentSchema = z.object({
  primary: z.string().min(1).nullable(),
  status: z.enum(INTENT_STATUSES),
  alternatives: z.array(z.string().min(1)),
  summary: z.string().min(1),
});

export const chatIntentResultSchema = z.object({
  intent: intentSchema,
  entities: z.array(entitySchema),
  actionItems: z.array(actionItemSchema),
  questions: z.array(questionSchema),
  urgency: z.enum(URGENCY_LEVELS),
  replyRequired: z.boolean().nullable(),
  unknowns: z.array(z.string().min(1)),
  assumptions: z.array(z.string().min(1)),
  ambiguities: z.array(z.string().min(1)),
});

export type IntentEntity = z.infer<typeof entitySchema>;
export type ActionItem = z.infer<typeof actionItemSchema>;
export type IntentQuestion = z.infer<typeof questionSchema>;
export type ChatIntent = z.infer<typeof intentSchema>;
export type ChatIntentResult = z.infer<typeof chatIntentResultSchema>;
