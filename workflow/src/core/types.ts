export type SendEmailParameterName = 'to' | 'subject' | 'body';

export type SendEmailParameters = Partial<Record<SendEmailParameterName, string>>;

export type SendEmailMissing = SendEmailParameterName[];

export interface SendEmailActionIdentificationResult {
  action: {
    identifier: string | null;
    status: 'clear' | 'ambiguous' | 'unknown';
    alternatives: string[];
    summary: string;
  };
  parameters: Array<{
    name: string;
    value: string;
    normalized: string | null;
    evidence: string;
  }>;
  missing: string[];
  assumptions: string[];
  ambiguities: string[];
}

export interface SendEmailContext {
  actionId: 'send_email';
  parameters: SendEmailParameters;
  missing: SendEmailMissing;
  result: SendEmailActionIdentificationResult | null;
  execution: { messageId: string } | null;
  error?: string;
}

export type SendEmailEvent =
  | { type: 'SUBMIT_MESSAGE'; message: string }
  | { type: 'IDENTIFICATION_FAILED'; error: string }
  | { type: 'IDENTIFIED'; result: SendEmailActionIdentificationResult }
  | { type: 'NEEDS_CLARIFICATION'; result: SendEmailActionIdentificationResult }
  | { type: 'CLARIFICATION_CHOSEN'; result: SendEmailActionIdentificationResult }
  | { type: 'PARAMETER_PROVIDED'; name: SendEmailParameterName; value: string }
  | { type: 'CONFIRM' }
  | { type: 'EDIT' }
  | { type: 'CANCEL' }
  | { type: 'EXECUTION_SUCCEEDED'; messageId: string }
  | { type: 'EXECUTION_FAILED'; error: string }
  | { type: 'RETRY' }
  | { type: 'RESET' };
