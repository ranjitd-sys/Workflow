import type {
  ActionIdentificationResult,
  ActionIdentifier,
  ActionParameter,
  StructuredLlmProvider,
} from '@workflow-execution/action-engine';

function extractEmail(message: string): string | undefined {
  return message.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0];
}

export function mockActionResult(message: string): ActionIdentificationResult {
  const lower = message.toLowerCase();
  const parameters: ActionParameter[] = [];
  const missing: string[] = [];

  let identifier: ActionIdentifier | null = 'request';
  if (/\b(email|e-mail|mail|send)\b/.test(lower)) {
    identifier = 'send_email';
    const email = extractEmail(message);
    if (email) {
      parameters.push({ name: 'recipient', value: email, normalized: email, evidence: email });
    } else {
      missing.push('recipient');
    }
  } else if (message.includes('?')) {
    identifier = 'question';
  } else if (/\b(fyi|for your information|notice|update)\b/.test(lower)) {
    identifier = 'informational';
  } else if (/\b(meeting|call|schedule|reschedule)\b/.test(lower)) {
    identifier = 'meeting';
  } else if (/\b(thanks|thank you|hello|hi|hey)\b/.test(lower)) {
    identifier = 'social';
  }

  return {
    action: {
      identifier,
      status: 'clear',
      alternatives: [],
      summary: `Local mock classification: ${identifier}.`,
    },
    parameters,
    missing,
    assumptions: ['This result came from the local mock provider (ACTION_LLM_MOCK=true), not an LLM.'],
    ambiguities: [],
  };
}

export function createMockActionProvider(message: string): StructuredLlmProvider {
  return {
    async generateStructured() {
      return mockActionResult(message);
    },
  };
}
