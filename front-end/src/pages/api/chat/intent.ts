import type { APIRoute } from 'astro';
import {
  ChatIntentEngine,
  EmptyMessageError,
  IntentEventPublisher,
  InMemoryEventSink,
  InvalidMessageError,
  LlmProviderError,
  OpenAiCompatibleProvider,
  type ChatIntentResult,
  type IntentId,
  type StructuredLlmProvider,
} from '@workflow-execution/chat-intent-engine';

/**
 * In-memory event store. Events survive for the lifetime of the server process.
 * Swap this for a webhook/queue sink later without touching the engine.
 */
const sink = new InMemoryEventSink();

interface IntentRequestBody {
  message: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  sessionId: string;
  messageId?: string;
  timestamp?: string;
}

function env(key: string): string | undefined {
  return process.env[key] ?? (import.meta.env as Record<string, string | undefined>)[key];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function parseBody(body: unknown): IntentRequestBody | null {
  if (!isRecord(body)) return null;
  if (typeof body.message !== 'string' || !body.message.trim()) return null;
  if (typeof body.sessionId !== 'string' || !body.sessionId.trim()) return null;

  const history = Array.isArray(body.history)
    ? body.history.flatMap((entry) => {
        if (!isRecord(entry)) return [];
        if (entry.role !== 'user' && entry.role !== 'assistant') return [];
        if (typeof entry.content !== 'string' || !entry.content.trim()) return [];
        return [{ role: entry.role, content: entry.content }];
      })
    : [];

  return {
    message: body.message,
    history,
    sessionId: body.sessionId,
    messageId: typeof body.messageId === 'string' ? body.messageId : undefined,
    timestamp: typeof body.timestamp === 'string' ? body.timestamp : undefined,
  };
}

/**
 * Deterministic local provider used only when INTENT_LLM_MOCK=true.
 * It exists so the UI/event pipeline can be exercised without an API key.
 */
function createMockProvider(message: string): StructuredLlmProvider {
  const lower = message.toLowerCase();

  let primary: IntentId = 'request';
  if (/\b(meeting|call|schedule|reschedule)\b/.test(lower)) {
    primary = 'meeting';
  } else if (message.includes('?')) {
    primary = 'question';
  } else if (/\b(fyi|for your information|notice|update)\b/.test(lower)) {
    primary = 'informational';
  } else if (/\b(thanks|thank you|hello|hi|hey)\b/.test(lower)) {
    primary = 'social';
  } else if (/\b(sale|discount|newsletter|offer)\b/.test(lower)) {
    primary = 'marketing';
  } else if (/\b(problem|broken|damaged|unhappy|complaint)\b/.test(lower)) {
    primary = 'complaint';
  }

  const result: ChatIntentResult = {
    intent: {
      primary,
      status: 'clear',
      alternatives: [],
      summary: `Local mock classification: ${primary}.`,
    },
    entities: [],
    actionItems: [],
    questions: [],
    urgency: 'unknown',
    replyRequired: primary === 'request' || primary === 'question' ? true : null,
    unknowns: [
      'This result came from the local mock provider (INTENT_LLM_MOCK=true), not an LLM.',
    ],
    assumptions: [],
    ambiguities: [],
  };

  return {
    async generateStructured() {
      return result;
    },
  };
}

function buildPublisher(message: string, useMock: boolean): IntentEventPublisher {
  let provider: StructuredLlmProvider;

  if (useMock) {
    provider = createMockProvider(message);
  } else {
    const apiKey = env('INTENT_LLM_API_KEY');
    if (!apiKey) {
      throw new LlmProviderError('INTENT_LLM_API_KEY is not set.');
    }
    provider = new OpenAiCompatibleProvider({
      apiKey,
      baseUrl: env('INTENT_LLM_BASE_URL'),
      model: env('INTENT_LLM_MODEL'),
    });
  }

  const engine = new ChatIntentEngine({ provider });
  return new IntentEventPublisher({ engine, sink });
}

export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Request body must be valid JSON.' }, 400);
  }

  const input = parseBody(body);
  if (!input) {
    return json(
      {
        error:
          'Body must include a non-empty "message", a "sessionId", and an optional history array.',
      },
      400,
    );
  }

  const useMock = env('INTENT_LLM_MOCK') === 'true';

  if (!useMock && !env('INTENT_LLM_API_KEY')) {
    return json(
      {
        error:
          'Intent engine is not configured. Set INTENT_LLM_API_KEY, or set INTENT_LLM_MOCK=true for local development.',
      },
      503,
    );
  }

  try {
    const publisher = buildPublisher(input.message, useMock);
    const { result, event } = await publisher.handle(input);

    return json({
      result,
      event,
      mock: useMock,
      eventCount: sink.events.length,
    });
  } catch (error) {
    if (error instanceof InvalidMessageError || error instanceof EmptyMessageError) {
      return json({ error: error.message }, 400);
    }
    if (error instanceof LlmProviderError) {
      return json({ error: error.message }, 502);
    }
    return json(
      { error: error instanceof Error ? error.message : 'Intent detection failed.' },
      500,
    );
  }
};

/** Debug endpoint: inspect the events currently held in memory. */
export const GET: APIRoute = async () => {
  return json({ count: sink.events.length, events: sink.events });
};
