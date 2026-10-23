export class ActionEngineError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class EmptyMessageError extends ActionEngineError {}

export class InvalidMessageError extends ActionEngineError {
  readonly issues: unknown;

  constructor(message: string, issues?: unknown, options?: { cause?: unknown }) {
    super(message, options);
    this.issues = issues;
  }
}

export class LlmProviderError extends ActionEngineError {}

export class ActionValidationError extends ActionEngineError {
  readonly issues: unknown;

  constructor(message: string, issues?: unknown, options?: { cause?: unknown }) {
    super(message, options);
    this.issues = issues;
  }
}

export class InvalidActionError extends ActionEngineError {
  readonly actionId: string;

  constructor(actionId: string) {
    super(`Model returned action identifier "${actionId}", which is not present in the supplied action catalog.`);
    this.actionId = actionId;
  }
}

export class EvidenceMismatchError extends ActionEngineError {
  readonly evidence: string;

  constructor(evidence: string) {
    super(`Model supplied evidence that does not appear in the message or supplied history: "${evidence}".`);
    this.evidence = evidence;
  }
}
