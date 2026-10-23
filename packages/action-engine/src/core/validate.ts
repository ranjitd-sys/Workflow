import { ActionValidationError, EvidenceMismatchError, InvalidActionError } from '../errors';
import { ActionRegistry } from '../taxonomy/registry';
import { actionIdentificationResultSchema, type ActionIdentificationResult } from '../types';

function normalizeForMatch(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function isWithinContext(evidence: string, contextText: string): boolean {
  return normalizeForMatch(contextText).includes(normalizeForMatch(evidence));
}

export interface ValidationOptions {
  strictEvidence?: boolean;
  referenceDate?: string;
}

export function validateActionIdentification(
  raw: unknown,
  registry: ActionRegistry,
  contextText: string,
  options: ValidationOptions = {},
): ActionIdentificationResult {
  const parsed = actionIdentificationResultSchema.safeParse(raw);

  if (!parsed.success) {
    throw new ActionValidationError(
      'Model returned output that does not match the expected action identification schema.',
      parsed.error.issues,
      { cause: parsed.error },
    );
  }

  const result = parsed.data;

  if (result.action.identifier !== null && !registry.has(result.action.identifier)) {
    throw new InvalidActionError(result.action.identifier);
  }

  for (const alternative of result.action.alternatives) {
    if (!registry.has(alternative)) {
      throw new InvalidActionError(alternative);
    }
  }

  const alternatives = [...new Set(result.action.alternatives)].filter(
    (id) => id !== result.action.identifier,
  );

  const hasIdentifier = result.action.identifier !== null;

  if ((result.action.status === 'clear' || result.action.status === 'ambiguous') && !hasIdentifier) {
    throw new ActionValidationError(
      `Status "${result.action.status}" requires an action identifier from the supplied catalog.`,
    );
  }

  if (result.action.status === 'unknown' && hasIdentifier) {
    throw new ActionValidationError('Status "unknown" must not include an action identifier.');
  }

  if (result.action.status === 'ambiguous' && alternatives.length === 0) {
    throw new ActionValidationError('Status "ambiguous" requires at least one plausible alternative action.');
  }

  const strictEvidence = options.strictEvidence ?? true;
  if (strictEvidence) {
    for (const parameter of result.parameters) {
      if (!isWithinContext(parameter.evidence, contextText)) {
        throw new EvidenceMismatchError(parameter.evidence);
      }
    }
  }

  return {
    ...result,
    action: { ...result.action, alternatives },
  };
}
