import type {
  StructuredGenerationRequest,
  StructuredLlmProvider,
} from '../src/providers/types';
import type { ChatIntentInput, ChatIntentResult } from '../src/types';

export interface MockProvider {
  provider: StructuredLlmProvider;
  calls: StructuredGenerationRequest[];
}

export function createMockProvider(
  response: unknown | (() => unknown | Promise<unknown>),
): MockProvider {
  const calls: StructuredGenerationRequest[] = [];

  const provider: StructuredLlmProvider = {
    async generateStructured(request) {
      calls.push(request);
      if (typeof response === 'function') {
        return await (response as () => unknown | Promise<unknown>)();
      }
      return response;
    },
  };

  return { provider, calls };
}

export type TestInput = ChatIntentInput & { sessionId: string };

export function makeInput(overrides: Partial<ChatIntentInput> = {}): TestInput {
  const base = {
    message: 'Test message',
    sessionId: 'session-1',
    messageId: 'message-1',
    timestamp: '2026-07-15T09:00:00Z',
  };
  return { ...base, ...overrides, sessionId: overrides.sessionId ?? base.sessionId };
}

export function makeResult(overrides: Partial<ChatIntentResult> = {}): ChatIntentResult {
  return {
    intent: {
      primary: 'request',
      status: 'clear',
      alternatives: [],
      summary: 'The user requests an action.',
    },
    entities: [],
    parameters: [],
    actionItems: [],
    questions: [],
    urgency: 'normal',
    replyRequired: true,
    unknowns: [],
    assumptions: [],
    ambiguities: [],
    ...overrides,
  };
}
