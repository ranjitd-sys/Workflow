export type IdentifiedActionStatus = 'clear' | 'ambiguous' | 'unknown';

export interface IdentifiedAction {
  identifier: string | null;
  status: IdentifiedActionStatus;
  alternatives: string[];
  summary: string;
}

export interface ActionParameter {
  name: string;
  value: string;
  normalized: string | null;
  evidence: string;
}

export interface ActionIdentifiedEvent {
  id: string;
  type: string;
  version: number;
  occurredAt: string;
  sessionId: string;
  messageId?: string;
  action: IdentifiedAction;
}

export interface ActionResponse {
  result: {
    action: IdentifiedAction;
    parameters: ActionParameter[];
    missing: string[];
    assumptions: string[];
    ambiguities: string[];
  };
  event: ActionIdentifiedEvent | null;
  mock: boolean;
  eventCount: number;
  supportedActions: string[];
}

export type ActionRequestResult =
  | { ok: true; response: ActionResponse }
  | { ok: false; error: string };

export interface IdentifyActionInput {
  message: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  sessionId: string;
  messageId?: string;
  timestamp?: string;
}

export interface ResolveActionInput {
  result: ActionResponse['result'];
  actionIdentifier: string;
  sessionId: string;
  messageId?: string;
}

export function formatActionIdentifier(id: string): string {
  return id
    .split(/[._]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

async function postAction(url: string, body: unknown): Promise<ActionRequestResult> {
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

    return { ok: true, response: (await response.json()) as ActionResponse };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Action request failed.',
    };
  }
}

export function identifyAction(input: IdentifyActionInput): Promise<ActionRequestResult> {
  return postAction('/api/chat/action', input);
}

export function resolveAction(input: ResolveActionInput): Promise<ActionRequestResult> {
  return postAction('/api/chat/action/resolve', input);
}
