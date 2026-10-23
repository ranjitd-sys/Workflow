import {
  EmptyMessageError,
  InvalidMessageError,
  LlmProviderError,
} from '@workflow-execution/action-engine';
import { actionEventStore, createActionPublisher } from '../action';
import { APP_ACTIONS } from '../actions/definitions';
import { isRecord, json, readJson } from '../http/json';

const SUPPORTED_ACTIONS = APP_ACTIONS.map((action) => action.id);

interface ActionRequestBody {
  message: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  sessionId: string;
  messageId?: string;
  timestamp?: string;
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

  return {
    message: body.message,
    history: parseHistory(body.history),
    sessionId: body.sessionId,
    messageId: typeof body.messageId === 'string' ? body.messageId : undefined,
    timestamp: typeof body.timestamp === 'string' ? body.timestamp : undefined,
  };
}

export async function handleChatAction(request: Request): Promise<Response> {
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;

  const input = parseBody(parsed.body);
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
}
