export type DetectedIntentStatus = 'clear' | 'ambiguous' | 'unknown';

export interface DetectedIntent {
  primary: string | null;
  status: DetectedIntentStatus;
  alternatives: string[];
  summary: string;
}

export interface DetectedIntentEvent {
  id: string;
  type: string;
  version: number;
  occurredAt: string;
  sessionId: string;
  intent: DetectedIntent;
}

export interface IntentResponse {
  result: {
    intent: DetectedIntent;
    entities: unknown[];
    actionItems: unknown[];
    questions: unknown[];
    urgency: string;
    replyRequired: boolean | null;
    unknowns: string[];
    assumptions: string[];
    ambiguities: string[];
  };
  event: DetectedIntentEvent | null;
  mock: boolean;
  eventCount: number;
}

export interface DetectIntentInput {
  message: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  sessionId: string;
  messageId?: string;
  timestamp?: string;
}

/**
 * Best-effort intent detection. Returns null when the route is unavailable or
 * the engine is not configured, so chat continues to work regardless.
 */
export async function detectIntent(input: DetectIntentInput): Promise<IntentResponse | null> {
  try {
    const response = await fetch('/api/chat/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });

    if (!response.ok) return null;
    return (await response.json()) as IntentResponse;
  } catch {
    return null;
  }
}
