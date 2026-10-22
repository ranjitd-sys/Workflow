import {
  ChatIntentValidationError,
  EvidenceMismatchError,
  InvalidIntentError,
} from '../errors';
import { IntentRegistry } from '../taxonomy/registry';
import {
  chatIntentResultSchema,
  type ActionItem,
  type ChatIntentResult,
  type IntentEntity,
} from '../types';
import { normalizeDate } from './dates';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const TIME_ONLY = /^\d{2}:\d{2}(?::\d{2})?$/;

export interface ValidationOptions {
  /** When true (default), evidence must literally appear in the supplied context. */
  strictEvidence?: boolean;
  /** Reference timestamp used to resolve relative dates such as "next Friday". */
  referenceDate?: string;
}

function normalizeForMatch(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function isWithinContext(evidence: string, contextText: string): boolean {
  return normalizeForMatch(contextText).includes(normalizeForMatch(evidence));
}

function assertDateFormats(
  entities: readonly IntentEntity[],
  actionItems: readonly ActionItem[],
): void {
  for (const entity of entities) {
    if (!entity.normalized) continue;

    if (entity.type === 'date' && !DATE_ONLY.test(entity.normalized)) {
      throw new ChatIntentValidationError(
        `Entity "${entity.text}" has an invalid normalized date "${entity.normalized}". Expected YYYY-MM-DD.`,
      );
    }

    if (entity.type === 'time' && !TIME_ONLY.test(entity.normalized)) {
      throw new ChatIntentValidationError(
        `Entity "${entity.text}" has an invalid normalized time "${entity.normalized}". Expected HH:MM or HH:MM:SS.`,
      );
    }
  }

  for (const actionItem of actionItems) {
    if (actionItem.dueDate && !DATE_ONLY.test(actionItem.dueDate)) {
      throw new ChatIntentValidationError(
        `Action item "${actionItem.description}" has an invalid due date "${actionItem.dueDate}". Expected YYYY-MM-DD.`,
      );
    }
  }
}

function enrichDates(
  result: ChatIntentResult,
  referenceDate: string | undefined,
): ChatIntentResult {
  const assumptions = [...result.assumptions];

  const rememberBasis = (basis: string): void => {
    if (!assumptions.includes(basis)) assumptions.push(basis);
  };

  const entities = result.entities.map((entity) => {
    if (entity.normalized || entity.type !== 'date') return entity;
    const normalized = normalizeDate(entity.text, referenceDate);
    if (!normalized) return entity;
    rememberBasis(normalized.basis);
    return { ...entity, normalized: normalized.normalized };
  });

  const actionItems = result.actionItems.map((actionItem) => {
    if (actionItem.dueDate) return actionItem;
    // Only derive from evidence, which is verified against the supplied text,
    // never from the model-authored description.
    const normalized = normalizeDate(actionItem.evidence, referenceDate);
    if (!normalized) return actionItem;
    rememberBasis(normalized.basis);
    return { ...actionItem, dueDate: normalized.normalized };
  });

  return { ...result, entities, actionItems, assumptions };
}

function assertIntents(result: ChatIntentResult, registry: IntentRegistry): string[] {
  const { intent } = result;

  if (intent.primary !== null && !registry.has(intent.primary)) {
    throw new InvalidIntentError(intent.primary);
  }

  for (const alternative of intent.alternatives) {
    if (!registry.has(alternative)) {
      throw new InvalidIntentError(alternative);
    }
  }

  const alternatives = [...new Set(intent.alternatives)].filter((id) => id !== intent.primary);

  const hasPrimary = intent.primary !== null;

  if ((intent.status === 'clear' || intent.status === 'ambiguous') && !hasPrimary) {
    throw new ChatIntentValidationError(
      `Status "${intent.status}" requires a primary intent from the supplied taxonomy.`,
    );
  }

  if (intent.status === 'unknown' && hasPrimary) {
    throw new ChatIntentValidationError(
      'Status "unknown" must not include a primary intent.',
    );
  }

  if (intent.status === 'ambiguous' && alternatives.length === 0) {
    throw new ChatIntentValidationError(
      'Status "ambiguous" requires at least one plausible alternative intent.',
    );
  }

  return alternatives;
}

/**
 * Validate raw model output against the schema, then apply semantic checks that
 * schema validation alone cannot provide.
 */
export function validateChatInterpretation(
  raw: unknown,
  registry: IntentRegistry,
  contextText: string,
  options: ValidationOptions = {},
): ChatIntentResult {
  const parsed = chatIntentResultSchema.safeParse(raw);

  if (!parsed.success) {
    throw new ChatIntentValidationError(
      'Model returned output that does not match the expected chat interpretation schema.',
      parsed.error.issues,
      { cause: parsed.error },
    );
  }

  const enriched = enrichDates(parsed.data, options.referenceDate);
  const alternatives = assertIntents(enriched, registry);

  assertDateFormats(enriched.entities, enriched.actionItems);

  const strictEvidence = options.strictEvidence ?? true;
  if (strictEvidence) {
    const evidenceValues: string[] = [
      ...enriched.entities.map((entity) => entity.evidence),
      ...enriched.actionItems.map((actionItem) => actionItem.evidence),
      ...enriched.questions.map((question) => question.evidence),
    ];

    for (const evidence of evidenceValues) {
      if (!isWithinContext(evidence, contextText)) {
        throw new EvidenceMismatchError(evidence);
      }
    }
  }

  return {
    ...enriched,
    intent: { ...enriched.intent, alternatives },
  };
}
