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
  supportedIntents: string[];
}

export type IntentRequestResult =
  | { ok: true; response: IntentResponse }
  | { ok: false; error: string };

export interface DetectIntentInput {
  message: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  sessionId: string;
  messageId?: string;
  timestamp?: string;
}

export interface ResolveIntentInput {
  result: IntentResponse['result'];
  intentId: string;
  sessionId: string;
  messageId?: string;
}

export function formatIntentId(id: string): string {
  return id.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

async function postIntent(url: string, body: unknown): Promise<IntentRequestResult> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const payload = (await response.json()) as { error?: unknown };
        if (typeof payload.error === 'string') message = payload.error;
      } catch {
        // Keep the status-based message.
      }
      return { ok: false, error: message };
    }

    return { ok: true, response: (await response.json()) as IntentResponse };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Intent request failed.',
    };
  }
}

/** Best-effort intent detection. */
export function detectIntent(input: DetectIntentInput): Promise<IntentRequestResult> {
  return postIntent('/api/chat/intent', input);
}

/** Resolve an ambiguous/unknown intent from an explicit user selection. */
export function resolveIntent(input: ResolveIntentInput): Promise<IntentRequestResult> {
  return postIntent('/api/chat/intent/resolve', input);
}
