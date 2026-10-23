import { describe, expect, it } from 'vitest';
import { mockActionResult } from '../src/server/mock-action';

describe('mockActionResult', () => {
  it('classifies an immediate email', () => {
    const result = mockActionResult('Send an email to john@acme.com about the invoice.');

    expect(result.action.identifier).toBe('send_email');
    expect(result.action.status).toBe('clear');
    expect(result.parameters.find((parameter) => parameter.name === 'to')?.value).toBe('john@acme.com');
    expect(result.missing).toContain('subject');
    expect(result.missing).toContain('body');
  });

  it('classifies a scheduled email', () => {
    const result = mockActionResult('Schedule an email to john@acme.com for tomorrow at 9.');

    expect(result.action.identifier).toBe('schedule_email');
    expect(result.action.status).toBe('clear');
    expect(result.parameters.find((parameter) => parameter.name === 'to')?.value).toBe('john@acme.com');
    expect(result.parameters.find((parameter) => parameter.name === 'send_at')?.value).toBe('tomorrow at 9');
  });

  it('returns unknown for unrelated text', () => {
    const result = mockActionResult('Hello there');

    expect(result.action.identifier).toBeNull();
    expect(result.action.status).toBe('unknown');
    expect(result.missing).toEqual([]);
  });
});
