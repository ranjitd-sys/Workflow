import type { APIRoute } from 'astro';
import {
  DEFAULT_INTENTS,
  chatIntentResultSchema,
  type ChatIntentResult,
} from '@workflow-execution/chat-intent-engine';
import { createIntentPublisher, intentEventStore } from '../../../../server/intent';

const SUPPORTED_INTENTS = DEFAULT_INTENTS.map((intent) => intent.id);
const SUPPORTED = new Set<string>(SUPPORTED_INTENTS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface ResolveBody {
  result: ChatIntentResult;
  intentId: string;
  sessionId: string;
  messageId?: string;
}

function parseBody(body: unknown): ResolveBody | null {
  if (!isRecord(body)) return null;
  if (typeof body.sessionId !== 'string' || !body.sessionId.trim()) return null;
  if (typeof body.intentId !== 'string' || !SUPPORTED.has(body.intentId)) return null;

  const parsed = chatIntentResultSchema.safeParse(body.result);
  if (!parsed.success) return null;

  return {
    result: parsed.data,
    intentId: body.intentId,
    sessionId: body.sessionId,
    messageId: typeof body.messageId === 'string' ? body.messageId : undefined,
  };
}

/**
 * Resolve an ambiguous/unknown intent from an explicit user selection.
 * No LLM call is made; the selected intent is published directly.
 */
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
          'Body must include a valid "result", a supported "intentId", and a non-empty "sessionId".',
      },
      400,
    );
  }

  const resolved: ChatIntentResult = {
    ...input.result,
    intent: {
      primary: input.intentId,
      status: 'clear',
      alternatives: [],
      summary: `User selected intent "${input.intentId}".`,
    },
  };

  try {
    const { publisher, mock } = createIntentPublisher('');
    const { result, event } = await publisher.publish(resolved, {
      sessionId: input.sessionId,
      messageId: input.messageId,
    });

    return json({
      result,
      event,
      mock,
      eventCount: intentEventStore.events.length,
      supportedIntents: SUPPORTED_INTENTS,
    });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Intent resolution failed.' },
      500,
    );
  }
};
