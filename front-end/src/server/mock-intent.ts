import type {
  ChatIntentResult,
  IntentId,
  IntentParameter,
  StructuredLlmProvider,
} from '@workflow-execution/chat-intent-engine';

/**
 * Deterministic classifier used only when INTENT_LLM_MOCK=true.
 * It exists so the UI and event pipeline can be exercised without an API key.
 */
export function mockIntentResult(message: string): ChatIntentResult {
  const lower = message.toLowerCase();
  const parameters: IntentParameter[] = [];
  const unknowns: string[] = [
    'This result came from the local mock provider (INTENT_LLM_MOCK=true), not an LLM.',
  ];

  let primary: IntentId = 'request';
  if (/\b(email|e-mail|mail)\b/.test(lower)) {
    primary = 'send_email';
  } else if (/\b(meeting|call|schedule|reschedule)\b/.test(lower)) {
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

  if (primary === 'send_email') {
    const emailMatch = message.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    if (emailMatch) {
      parameters.push({
        name: 'recipient',
        value: emailMatch[0],
        normalized: emailMatch[0],
        evidence: emailMatch[0],
      });
    } else {
      unknowns.push('Recipient email address is missing.');
    }

    const bodyMatch = /\bsaying\s+["']?(.+?)["']?\s*$/i.exec(message);
    const body = bodyMatch?.[1]?.trim();
    if (body) {
      parameters.push({
        name: 'body',
        value: body,
        normalized: null,
        evidence: body,
      });
    } else {
      unknowns.push('Email body is missing.');
    }
  }

  return {
    intent: {
      primary,
      status: 'clear',
      alternatives: [],
      summary: `Local mock classification: ${primary}.`,
    },
    entities: [],
    parameters,
    actionItems: [],
    questions: [],
    urgency: 'unknown',
    replyRequired: primary === 'request' || primary === 'question' ? true : null,
    unknowns,
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
