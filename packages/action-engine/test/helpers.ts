import type {
  ActionDefinition,
  ActionIdentificationInput,
  ActionIdentificationResult,
} from '../src/types';
import type {
  StructuredGenerationRequest,
  StructuredLlmProvider,
} from '../src/providers/types';
import { ActionRegistry } from '../src/taxonomy/registry';

export const TEST_ACTIONS: ActionDefinition[] = [
  {
    id: 'test.action.one',
    name: 'Test Action One',
    description: 'First test action.',
    examples: ['Do the first thing.'],
    parameters: [{ name: 'value', description: 'A value.', required: true }],
  },
  {
    id: 'test.action.two',
    name: 'Test Action Two',
    description: 'Second test action.',
    examples: ['Do the second thing.'],
  },
];

export const testRegistry = new ActionRegistry(TEST_ACTIONS);

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

export type TestInput = ActionIdentificationInput & { sessionId: string };

export function makeInput(overrides: Partial<ActionIdentificationInput> = {}): TestInput {
  const base = {
    message: 'Test message',
    sessionId: 'session-1',
    messageId: 'message-1',
    timestamp: '2026-07-15T09:00:00Z',
  };
  return { ...base, ...overrides, sessionId: overrides.sessionId ?? base.sessionId };
}

export function makeResult(overrides: Partial<ActionIdentificationResult> = {}): ActionIdentificationResult {
  return {
    action: {
      identifier: 'test.action.one',
      status: 'clear',
      alternatives: [],
      summary: 'The user requests an action.',
    },
    parameters: [],
    missing: [],
    assumptions: [],
    ambiguities: [],
    ...overrides,
  };
}
