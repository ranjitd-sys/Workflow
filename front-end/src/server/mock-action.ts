import type {
  ActionIdentificationResult,
  ActionIdentifier,
  ActionParameter,
  StructuredLlmProvider,
} from '@workflow-execution/action-engine';

function extractEmail(message: string): string | undefined {
  return message.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0];
}

function extractScheduleTime(message: string): string | undefined {
  const patterns = [
    /\b(tomorrow(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b)/i,
    /\b(today(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b)/i,
    /\b(next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?\b)/i,
    /\b(in\s+\d+\s+(?:minute|minutes|hour|hours|day|days|week|weeks)\b)/i,
    /\b(\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?)\b/,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) return match[1].trim();
  }

  return undefined;
}

function isSchedule(message: string): boolean {
  return /\b(schedule|send later|send tomorrow|next monday|next tuesday|next wednesday|next thursday|next friday|next saturday|next sunday)\b/i.test(
    message,
  );
}

export function mockActionResult(message: string): ActionIdentificationResult {
  const lower = message.toLowerCase();
  const parameters: ActionParameter[] = [];
  const missing: string[] = [];

  let identifier: ActionIdentifier | null = null;

  if (/\b(email|e-mail|mail|send)\b/.test(lower)) {
    const schedule = isSchedule(message);
    identifier = schedule ? 'schedule_email' : 'send_email';

    const email = extractEmail(message);
    if (email) {
      parameters.push({ name: 'to', value: email, normalized: email, evidence: email });
    } else {
      missing.push('to');
    }

    if (schedule) {
      const sendAt = extractScheduleTime(message);
      if (sendAt) {
        parameters.push({ name: 'send_at', value: sendAt, normalized: sendAt, evidence: sendAt });
      } else {
        missing.push('send_at');
      }
    }

    missing.push('subject', 'body');
  }

  if (identifier === null) {
    return {
      action: {
        identifier: null,
        status: 'unknown',
        alternatives: [],
        summary: 'Local mock classification: unknown.',
      },
      parameters: [],
      missing: [],
      assumptions: ['This result came from the local mock provider (ACTION_LLM_MOCK=true), not an LLM.'],
      ambiguities: [],
    };
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
