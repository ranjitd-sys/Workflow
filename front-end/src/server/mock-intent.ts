import type {
  ChatIntentResult,
  IntentId,
  StructuredLlmProvider,
} from '@workflow-execution/chat-intent-engine';

/**
 * Deterministic classifier used only when INTENT_LLM_MOCK=true.
 * It exists so the UI and event pipeline can be exercised without an API key.
 */
export function mockIntentResult(message: string): ChatIntentResult {
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

  return {
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
}

export function createMockIntentProvider(message: string): StructuredLlmProvider {
  return {
    async generateStructured() {
      return mockIntentResult(message);
    },
  };
}
