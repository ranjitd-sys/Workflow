import { describe, expect, it } from 'vitest';
import { DEFAULT_INTENTS } from '../src/taxonomy/definitions';
import { IntentRegistry } from '../src/taxonomy/registry';
import { validateChatInterpretation } from '../src/core/validate';
import { ChatIntentValidationError, InvalidIntentError } from '../src/errors';
import { makeResult } from './helpers';

const registry = new IntentRegistry(DEFAULT_INTENTS);
const context = 'Please send the Q3 report by July 31, 2026.';

describe('validateChatInterpretation', () => {
  it('accepts a valid interpretation', () => {
    const result = validateChatInterpretation(makeResult(), registry, context);
    expect(result.intent.primary).toBe('request');
  });

  it('rejects an unknown primary intent id', () => {
    const raw = makeResult({
      intent: {
        primary: 'not_a_real_intent' as never,
        status: 'clear',
        alternatives: [],
        summary: 'test',
      },
    });

    expect(() => validateChatInterpretation(raw, registry, context)).toThrow(InvalidIntentError);
  });

  it('rejects an unknown alternative intent id', () => {
    const raw = makeResult({
      intent: {
        primary: 'request',
        status: 'ambiguous',
        alternatives: ['invented_intent' as never],
        summary: 'test',
      },
    });

    expect(() => validateChatInterpretation(raw, registry, context)).toThrow(InvalidIntentError);
  });

  it('rejects ambiguous status without alternatives', () => {
    const raw = makeResult({
      intent: {
        primary: 'request',
        status: 'ambiguous',
        alternatives: [],
        summary: 'test',
      },
    });

    expect(() => validateChatInterpretation(raw, registry, context)).toThrow(
      ChatIntentValidationError,
    );
  });

  it('rejects a missing primary for a clear intent', () => {
    const raw = makeResult({
      intent: { primary: null, status: 'clear', alternatives: [], summary: 'test' },
    });

    expect(() => validateChatInterpretation(raw, registry, context)).toThrow(
      ChatIntentValidationError,
    );
  });

  it('rejects a primary intent when the status is unknown', () => {
    const raw = makeResult({
      intent: { primary: 'request', status: 'unknown', alternatives: [], summary: 'test' },
    });

    expect(() => validateChatInterpretation(raw, registry, context)).toThrow(
      ChatIntentValidationError,
    );
  });

  it('rejects an invalid normalized date format', () => {
    const raw = makeResult({
      entities: [
        {
          type: 'date',
          text: 'July 31, 2026',
          normalized: '31/07/2026',
          evidence: 'July 31, 2026',
        },
      ],
    });

    expect(() => validateChatInterpretation(raw, registry, context)).toThrow(
      ChatIntentValidationError,
    );
  });

  it('rejects an invalid due date format', () => {
    const raw = makeResult({
      actionItems: [
        {
          description: 'Send the report',
          owner: 'recipient',
          dueDate: '31/07/2026',
          evidence: 'July 31, 2026',
        },
      ],
    });

    expect(() => validateChatInterpretation(raw, registry, context)).toThrow(
      ChatIntentValidationError,
    );
  });

  it('deduplicates alternatives and removes the primary', () => {
    const raw = makeResult({
      intent: {
        primary: 'request',
        status: 'ambiguous',
        alternatives: ['question', 'question', 'request'],
        summary: 'test',
      },
    });

    const result = validateChatInterpretation(raw, registry, context);
    expect(result.intent.alternatives).toEqual(['question']);
  });

  it('fills a missing normalized date and records the convention', () => {
    const raw = makeResult({
      entities: [
        {
          type: 'date',
          text: 'July 31, 2026',
          normalized: null,
          evidence: 'July 31, 2026',
        },
      ],
    });

    const result = validateChatInterpretation(raw, registry, context);
    expect(result.entities[0]?.normalized).toBe('2026-07-31');
    expect(result.assumptions.join(' ')).toContain('explicit date');
  });

  it('can disable strict evidence checking', () => {
    const raw = makeResult({
      entities: [
        {
          type: 'organization',
          text: 'ACME',
          normalized: null,
          evidence: 'not in the message',
        },
      ],
    });

    const result = validateChatInterpretation(raw, registry, context, {
      strictEvidence: false,
    });
    expect(result.entities).toHaveLength(1);
  });
});
