/**
 * Base class for all controlled failures raised by the chat intent engine.
 */
export class ChatIntentEngineError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class EmptyMessageError extends ChatIntentEngineError {}

export class InvalidMessageError extends ChatIntentEngineError {
  readonly issues: unknown;

  constructor(message: string, issues?: unknown, options?: { cause?: unknown }) {
    super(message, options);
    this.issues = issues;
  }
}

export class LlmProviderError extends ChatIntentEngineError {}

export class ChatIntentValidationError extends ChatIntentEngineError {
  readonly issues: unknown;

  constructor(message: string, issues?: unknown, options?: { cause?: unknown }) {
    super(message, options);
    this.issues = issues;
  }
}

export class InvalidIntentError extends ChatIntentEngineError {
  readonly intentId: string;

  constructor(intentId: string) {
    super(
      `Model returned intent "${intentId}", which is not present in the supplied intent taxonomy.`,
    );
    this.intentId = intentId;
  }
}

export class EvidenceMismatchError extends ChatIntentEngineError {
  readonly evidence: string;

  constructor(evidence: string) {
    super(
      `Model supplied evidence that does not appear in the message or supplied history: "${evidence}".`,
    );
    this.evidence = evidence;
  }
}
