import { z } from 'zod';

export type ActionIdentifier = string;

export const ACTION_STATUSES = ['clear', 'ambiguous', 'unknown'] as const;

export type ActionStatus = (typeof ACTION_STATUSES)[number];

export interface ActionDefinition {
  /** Stable identifier the model is allowed to return. */
  id: string;
  name: string;
  description: string;
  examples: string[];
  synonyms?: string[];
  parameters?: {
    name: string;
    description: string;
    required: boolean;
  }[];
}

export const chatHistoryMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1),
});

export const actionIdentificationInputSchema = z.object({
  message: z.string().min(1),
  history: z.array(chatHistoryMessageSchema).optional(),
  sessionId: z.string().min(1).optional(),
  messageId: z.string().min(1).optional(),
  timestamp: z.string().min(1).optional(),
});

export type ChatHistoryMessage = z.infer<typeof chatHistoryMessageSchema>;
export type ActionIdentificationInput = z.infer<typeof actionIdentificationInputSchema>;

export const parameterSchema = z.object({
  name: z.string().min(1),
  value: z.string().min(1),
  normalized: z.string().min(1).nullish(),
  evidence: z.string().min(1),
});

export const identifiedActionSchema = z.object({
  identifier: z.string().min(1).nullable(),
  status: z.enum(ACTION_STATUSES),
  alternatives: z.array(z.string().min(1)),
  summary: z.string().min(1),
});

export const actionIdentificationResultSchema = z.object({
  action: identifiedActionSchema,
  parameters: z.array(parameterSchema),
  missing: z.array(z.string().min(1)),
  assumptions: z.array(z.string().min(1)),
  ambiguities: z.array(z.string().min(1)),
});

export type ActionParameter = z.infer<typeof parameterSchema>;
export type IdentifiedAction = z.infer<typeof identifiedActionSchema>;
export type ActionIdentificationResult = z.infer<typeof actionIdentificationResultSchema>;
