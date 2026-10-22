import { describe, expect, it } from 'vitest';
import { prepareContext, toEvidenceText } from '../src/core/context';

describe('prepareContext', () => {
  it('truncates a long message', () => {
    const prepared = prepareContext('x'.repeat(100), [], { maxMessageChars: 20 });
    expect(prepared.messageTruncated).toBe(true);
    expect(prepared.message.length).toBeLessThanOrEqual(21);
  });

  it('keeps only the most recent history messages in order', () => {
    const history = Array.from({ length: 5 }, (_, index) => ({
      role: 'user' as const,
      content: `message ${index + 1}`,
    }));

    const prepared = prepareContext('current', history, { maxHistoryMessages: 2 });
    expect(prepared.history.map((entry) => entry.content)).toEqual(['message 4', 'message 5']);
    expect(prepared.historyTruncated).toBe(true);
  });

  it('drops older history when the character budget is exceeded', () => {
    const history = [
      { role: 'user' as const, content: 'a'.repeat(100) },
      { role: 'assistant' as const, content: 'b'.repeat(100) },
      { role: 'user' as const, content: 'short' },
    ];

    const prepared = prepareContext('current', history, { maxHistoryChars: 50 });
    expect(prepared.history.map((entry) => entry.content)).toEqual(['short']);
  });

  it('ignores blank history messages', () => {
    const prepared = prepareContext('current', [
      { role: 'user', content: '   ' },
      { role: 'assistant', content: 'hello' },
    ]);

    expect(prepared.history.map((entry) => entry.content)).toEqual(['hello']);
  });

  it('trims the current message', () => {
    const prepared = prepareContext('  hello  ');
    expect(prepared.message).toBe('hello');
  });
});

describe('toEvidenceText', () => {
  it('combines history and the current message', () => {
    const text = toEvidenceText('Group it by customer.', [
      { role: 'user', content: 'Show me sales for 2026.' },
    ]);

    expect(text).toContain('Show me sales for 2026.');
    expect(text).toContain('Group it by customer.');
  });
});
