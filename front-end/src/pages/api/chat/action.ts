import type { APIRoute } from 'astro';
import {
  EmptyMessageError,
  InvalidMessageError,
  LlmProviderError,
} from '@workflow-execution/action-engine';
import { createActionPublisher, actionEventStore } from '../../../server/action';
import { APP_ACTIONS } from '../../../server/actions/definitions';

const SUPPORTED_ACTIONS = APP_ACTIONS.map((action) => action.id);

interface ActionRequestBody {
  message: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  sessionId: string;
  messageId?: string;
  timestamp?: string;
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

function isChatRole(value: unknown): value is 'user' | 'assistant' {
  return value === 'user' || value === 'assistant';
}

function parseHistory(value: unknown): ActionRequestBody['history'] {
  if (!Array.isArray(value)) return [];

  const history: ActionRequestBody['history'] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    if (!isChatRole(entry.role)) continue;
    if (typeof entry.content !== 'string' || !entry.content.trim()) continue;
    history.push({ role: entry.role, content: entry.content });
  }
  return history;
}

function parseBody(body: unknown): ActionRequestBody | null {
  if (!isRecord(body)) return null;
  if (typeof body.message !== 'string' || !body.message.trim()) return null;
  if (typeof body.sessionId !== 'string' || !body.sessionId.trim()) return null;

  const history = parseHistory(body.history);

  return {
    message: body.message,
    history,
    sessionId: body.sessionId,
    messageId: typeof body.messageId === 'string' ? body.messageId : undefined,
    timestamp: typeof body.timestamp === 'string' ? body.timestamp : undefined,
  };
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

  try {
    const { publisher, mock } = createActionPublisher(input.message);
    const { result, event } = await publisher.handle(input);

    return json({
      result,
      event,
      mock,
      eventCount: actionEventStore.events.length,
      supportedActions: SUPPORTED_ACTIONS,
    });
  } catch (error) {
    if (error instanceof InvalidMessageError || error instanceof EmptyMessageError) {
      return json({ error: error.message }, 400);
    }
    if (error instanceof LlmProviderError) {
      return json({ error: error.message }, 502);
    }
    return json(
      { error: error instanceof Error ? error.message : 'Action identification failed.' },
      500,
    );
  }
};
