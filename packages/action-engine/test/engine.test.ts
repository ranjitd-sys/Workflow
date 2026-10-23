import { describe, expect, it } from 'vitest';
import { ActionEngine } from '../src/core/engine';
import { EmptyMessageError, InvalidMessageError } from '../src/errors';
import { createMockProvider, makeInput, TEST_ACTIONS } from './helpers';

describe('ActionEngine', () => {
  it('identifies a clear action', async () => {
    const { provider } = createMockProvider({
      action: { identifier: 'test.action.one', status: 'clear', alternatives: [], summary: 'Clear.' },
      parameters: [],
      missing: [],
      assumptions: [],
      ambiguities: [],
    });

    const engine = new ActionEngine({ provider, actions: TEST_ACTIONS });
    const result = await engine.identify(makeInput());

    expect(result.action.identifier).toBe('test.action.one');
    expect(result.action.status).toBe('clear');
  });

  it('returns unknown for an unknown message', async () => {
    const { provider } = createMockProvider({
      action: { identifier: null, status: 'unknown', alternatives: [], summary: 'Unknown.' },
      parameters: [],
      missing: [],
      assumptions: [],
      ambiguities: [],
    });

    const engine = new ActionEngine({ provider, actions: TEST_ACTIONS });
    const result = await engine.identify(makeInput());

    expect(result.action.identifier).toBeNull();
    expect(result.action.status).toBe('unknown');
  });

  it('rejects an empty message', async () => {
    const { provider } = createMockProvider({});
    const engine = new ActionEngine({ provider, actions: TEST_ACTIONS });
    await expect(engine.identify(makeInput({ message: '   ' }))).rejects.toBeInstanceOf(EmptyMessageError);
  });

  it('rejects invalid input', async () => {
    const { provider } = createMockProvider({});
    const engine = new ActionEngine({ provider, actions: TEST_ACTIONS });
    // @ts-expect-error invalid input
    await expect(engine.identify({ message: 42 })).rejects.toBeInstanceOf(InvalidMessageError);
  });

  it('requires an action catalog', () => {
    const { provider } = createMockProvider({});
    expect(() => new ActionEngine({ provider })).toThrow();
  });

  it('truncates long messages and records an assumption', async () => {
    const { provider } = createMockProvider({
      action: { identifier: 'test.action.one', status: 'clear', alternatives: [], summary: 'Clear.' },
      parameters: [],
      missing: [],
      assumptions: [],
      ambiguities: [],
    });

    const engine = new ActionEngine({ provider, actions: TEST_ACTIONS, maxMessageChars: 5 });
    const result = await engine.identify(makeInput({ message: 'A very long message' }));

    expect(result.assumptions.some((item) => item.includes('truncated'))).toBe(true);
  });
});
