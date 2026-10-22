import { describe, expect, it } from 'vitest';
import {
  normalizeDate,
  parseExplicitDate,
  parseRelativeDate,
} from '../src/core/dates';

describe('parseExplicitDate', () => {
  it('parses an ISO date', () => {
    expect(parseExplicitDate('due 2026-07-31')?.normalized).toBe('2026-07-31');
  });

  it('parses "Month D, YYYY"', () => {
    expect(parseExplicitDate('by July 31, 2026')?.normalized).toBe('2026-07-31');
  });

  it('parses "D Month YYYY"', () => {
    expect(parseExplicitDate('by 31 July 2026')?.normalized).toBe('2026-07-31');
  });

  it('rejects an impossible date', () => {
    expect(parseExplicitDate('February 30, 2026')).toBeNull();
  });

  it('returns null when no explicit date is present', () => {
    expect(parseExplicitDate('sometime soon')).toBeNull();
  });
});

describe('parseRelativeDate', () => {
  it('resolves "today", "tomorrow", and "in N days" against a reference date', () => {
    expect(parseRelativeDate('today', '2026-07-15')?.normalized).toBe('2026-07-15');
    expect(parseRelativeDate('tomorrow', '2026-07-15')?.normalized).toBe('2026-07-16');
    expect(parseRelativeDate('in 3 days', '2026-07-15')?.normalized).toBe('2026-07-18');
  });

  it('resolves "next Friday"', () => {
    // 2026-07-15 is a Wednesday, so next Friday is 2026-07-17.
    expect(parseRelativeDate('by next Friday', '2026-07-15')?.normalized).toBe('2026-07-17');
  });

  it('resolves "this Monday"', () => {
    // 2026-07-15 is a Wednesday, so this Monday is 2026-07-20.
    expect(parseRelativeDate('this Monday', '2026-07-15')?.normalized).toBe('2026-07-20');
  });

  it('returns null without a reference date', () => {
    expect(parseRelativeDate('tomorrow')).toBeNull();
  });

  it('does not guess a bare weekday name', () => {
    expect(parseRelativeDate('Friday', '2026-07-15')).toBeNull();
  });
});

describe('normalizeDate', () => {
  it('prefers explicit dates over relative parsing', () => {
    expect(normalizeDate('2026-08-01', '2026-07-15')?.normalized).toBe('2026-08-01');
  });

  it('falls back to relative parsing', () => {
    expect(normalizeDate('tomorrow', '2026-07-15')?.normalized).toBe('2026-07-16');
  });
});
