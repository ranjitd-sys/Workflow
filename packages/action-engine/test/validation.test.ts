import { describe, expect, it } from 'vitest';
import { ActionValidationError, InvalidActionError } from '../src/errors';
import { ActionRegistry } from '../src/taxonomy/registry';
import { validateActionIdentification } from '../src/core/validate';
import { TEST_ACTIONS } from './helpers';

const registry = new ActionRegistry(TEST_ACTIONS);
const context = 'Send an email to jane@acme.com.';

describe('validateActionIdentification', () => {
  it('accepts a valid clear action', () => {
    const raw = {
      action: { identifier: 'test.action.one', status: 'clear', alternatives: [], summary: 'ok' },
      parameters: [{ name: 'value', value: 'x', normalized: null, evidence: 'x' }],
      missing: [],
      assumptions: [],
      ambiguities: [],
    };
    // evidence must appear in context; use a value present in context
    const result = validateActionIdentification(
      {
        action: { identifier: 'test.action.one', status: 'clear', alternatives: [], summary: 'ok' },
        parameters: [{ name: 'value', value: 'jane@acme.com', normalized: null, evidence: 'jane@acme.com' }],
        missing: [],
        assumptions: [],
        ambiguities: [],
      },
      registry,
      context,
    );
    expect(result.action.identifier).toBe('test.action.one');
    expect(result.action.status).toBe('clear');
  });

  it('rejects an unknown action identifier', () => {
    const raw = {
      action: { identifier: 'not.real', status: 'clear', alternatives: [], summary: 'ok' },
      parameters: [],
      missing: [],
      assumptions: [],
      ambiguities: [],
    };
    expect(() => validateActionIdentification(raw, registry, context)).toThrow(InvalidActionError);
  });

  it('rejects a missing identifier for clear status', () => {
    const raw = {
      action: { identifier: null, status: 'clear', alternatives: [], summary: 'ok' },
      parameters: [],
      missing: [],
      assumptions: [],
      ambiguities: [],
    };
    expect(() => validateActionIdentification(raw, registry, context)).toThrow(ActionValidationError);
  });

  it('rejects an identifier for unknown status', () => {
    const raw = {
      action: { identifier: 'test.action.one', status: 'unknown', alternatives: [], summary: 'ok' },
      parameters: [],
      missing: [],
      assumptions: [],
      ambiguities: [],
    };
    expect(() => validateActionIdentification(raw, registry, context)).toThrow(ActionValidationError);
  });

  it('rejects ambiguous status without alternatives', () => {
    const raw = {
      action: { identifier: 'test.action.one', status: 'ambiguous', alternatives: [], summary: 'ok' },
      parameters: [],
      missing: [],
      assumptions: [],
      ambiguities: [],
    };
    expect(() => validateActionIdentification(raw, registry, context)).toThrow(ActionValidationError);
  });

  it('deduplicates alternatives and removes the primary', () => {
    const raw = {
      action: {
        identifier: 'test.action.one',
        status: 'ambiguous',
        alternatives: ['test.action.two', 'test.action.two', 'test.action.one'],
        summary: 'ok',
      },
      parameters: [],
      missing: [],
      assumptions: [],
      ambiguities: [],
    };
    const result = validateActionIdentification(raw, registry, context);
    expect(result.action.alternatives).toEqual(['test.action.two']);
  });

  it('rejects evidence that is not in the context', () => {
    const raw = {
      action: { identifier: 'test.action.one', status: 'clear', alternatives: [], summary: 'ok' },
      parameters: [{ name: 'value', value: 'x', normalized: null, evidence: 'not in context' }],
      missing: [],
      assumptions: [],
      ambiguities: [],
    };
    expect(() => validateActionIdentification(raw, registry, context)).toThrow();
  });
});
