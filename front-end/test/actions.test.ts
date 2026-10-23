import { describe, expect, it } from 'vitest';
import { APP_ACTIONS } from '../src/server/actions/definitions';

describe('APP_ACTIONS', () => {
  it('contains only the two email actions', () => {
    expect(APP_ACTIONS.map((action) => action.id).sort()).toEqual(['schedule_email', 'send_email']);
  });

  it('has unique identifiers', () => {
    const ids = APP_ACTIONS.map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('defines the expected required parameters', () => {
    const send = APP_ACTIONS.find((action) => action.id === 'send_email');
    const schedule = APP_ACTIONS.find((action) => action.id === 'schedule_email');

    expect(send?.parameters?.map((parameter) => parameter.name)).toEqual(['to', 'subject', 'body']);
    expect(schedule?.parameters?.map((parameter) => parameter.name)).toEqual(['to', 'subject', 'body', 'send_at']);
    expect(send?.parameters?.every((parameter) => parameter.required)).toBe(true);
    expect(schedule?.parameters?.every((parameter) => parameter.required)).toBe(true);
  });
});
