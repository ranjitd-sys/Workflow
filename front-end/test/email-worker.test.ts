import { describe, expect, it, vi } from 'vitest';
import type { ChatIntentEvent } from '@workflow-execution/chat-intent-engine';
import { EmailOutbox, type EmailSender } from '../src/server/email-sender';
import { EmailWorker } from '../src/server/email-worker';

function makeEvent(overrides: Partial<ChatIntentEvent> = {}): ChatIntentEvent {
  return {
    id: 'event-1',
    type: 'chat.intent.detected',
    version: 1,
    occurredAt: '2026-07-15T10:00:00.000Z',
    sessionId: 'session-1',
    messageId: 'message-1',
    source: 'chat',
    intent: {
      primary: 'send_email',
      status: 'clear',
      alternatives: [],
      summary: 'Send an email to john@acme.com.',
    },
    entities: [],
    parameters: [
      {
        name: 'recipient',
        value: 'john@acme.com',
        normalized: 'john@acme.com',
        evidence: 'john@acme.com',
      },
      {
        name: 'body',
        value: "I'll be late",
        normalized: null,
        evidence: "I'll be late",
      },
    ],
    actionItems: [],
    questions: [],
    urgency: 'unknown',
    replyRequired: null,
    unknowns: [],
    assumptions: [],
    ambiguities: [],
    ...overrides,
  };
}

describe('EmailWorker', () => {
  it('sends an email for a valid clear send_email event', async () => {
    const outbox = new EmailOutbox();
    const sender: EmailSender = {
      send: vi.fn(async () => ({ id: 'email-1' })),
    };
    const worker = new EmailWorker(sender, outbox);

    await worker.handle(makeEvent());

    expect(sender.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'john@acme.com',
        body: "I'll be late",
      }),
    );

    const records = outbox.list('session-1');
    expect(records).toHaveLength(1);
    expect(records[0]?.status).toBe('sent');
    expect(records[0]?.to).toBe('john@acme.com');
    expect(records[0]?.id).toBe('email-1');
  });

  it('does not send when the recipient is missing', async () => {
    const outbox = new EmailOutbox();
    const sender: EmailSender = { send: vi.fn(async () => ({ id: 'email-1' })) };
    const worker = new EmailWorker(sender, outbox);

    await worker.handle(
      makeEvent({
        parameters: [
          {
            name: 'body',
            value: "I'll be late",
            normalized: null,
            evidence: "I'll be late",
          },
        ],
      }),
    );

    expect(sender.send).not.toHaveBeenCalled();
    const records = outbox.list('session-1');
    expect(records).toHaveLength(1);
    expect(records[0]?.status).toBe('needs_info');
    expect(records[0]?.reason).toContain('Recipient');
  });

  it('does not send to an invalid email address', async () => {
    const outbox = new EmailOutbox();
    const sender: EmailSender = { send: vi.fn(async () => ({ id: 'email-1' })) };
    const worker = new EmailWorker(sender, outbox);

    await worker.handle(
      makeEvent({
        parameters: [
          {
            name: 'recipient',
            value: 'john',
            normalized: 'john',
            evidence: 'john',
          },
          {
            name: 'body',
            value: "I'll be late",
            normalized: null,
            evidence: "I'll be late",
          },
        ],
      }),
    );

    expect(sender.send).not.toHaveBeenCalled();
    expect(outbox.list('session-1')[0]?.status).toBe('needs_info');
  });

  it('does not send when the body is empty', async () => {
    const outbox = new EmailOutbox();
    const sender: EmailSender = { send: vi.fn(async () => ({ id: 'email-1' })) };
    const worker = new EmailWorker(sender, outbox);

    await worker.handle(
      makeEvent({
        parameters: [
          {
            name: 'recipient',
            value: 'john@acme.com',
            normalized: 'john@acme.com',
            evidence: 'john@acme.com',
          },
        ],
      }),
    );

    expect(sender.send).not.toHaveBeenCalled();
    const record = outbox.list('session-1')[0];
    expect(record?.status).toBe('needs_info');
    expect(record?.reason).toContain('body');
  });

  it('processes the same event only once', async () => {
    const outbox = new EmailOutbox();
    const sender: EmailSender = { send: vi.fn(async () => ({ id: 'email-1' })) };
    const worker = new EmailWorker(sender, outbox);

    await worker.handle(makeEvent());
    await worker.handle(makeEvent());

    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(outbox.list('session-1')).toHaveLength(1);
  });

  it('ignores events with a different intent', async () => {
    const outbox = new EmailOutbox();
    const sender: EmailSender = { send: vi.fn(async () => ({ id: 'email-1' })) };
    const worker = new EmailWorker(sender, outbox);

    await worker.handle(
      makeEvent({
        intent: {
          primary: 'request',
          status: 'clear',
          alternatives: [],
          summary: 'A request.',
        },
      }),
    );

    expect(sender.send).not.toHaveBeenCalled();
    expect(outbox.list()).toHaveLength(0);
  });

  it('records a failure when the sender throws', async () => {
    const outbox = new EmailOutbox();
    const sender: EmailSender = {
      async send() {
        throw new Error('smtp unavailable');
      },
    };
    const worker = new EmailWorker(sender, outbox);

    await worker.handle(makeEvent());

    const record = outbox.list('session-1')[0];
    expect(record?.status).toBe('failed');
    expect(record?.reason).toContain('smtp unavailable');
  });
});
