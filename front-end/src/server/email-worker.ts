import { randomUUID } from 'node:crypto';
import type { ChatIntentEvent } from '@workflow-execution/chat-intent-engine';
import {
  emailOutbox,
  emailSender,
  type EmailOutbox,
  type EmailSender,
  type SentEmailRecord,
} from './email-sender';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function findParameter(event: ChatIntentEvent, names: string[]): string | undefined {
  for (const name of names) {
    const parameter = event.parameters.find(
      (candidate) => candidate.name.trim().toLowerCase() === name,
    );
    if (parameter) {
      return (parameter.normalized ?? parameter.value).trim();
    }
  }
  return undefined;
}

/**
 * Event-driven email worker.
 *
 * State per event:
 *   received → validating → sending → sent
 *                          └────────→ needs_info
 *                          └────────→ failed
 */
export class EmailWorker {
  private readonly processed = new Set<string>();

  constructor(
    private readonly sender: EmailSender = emailSender,
    private readonly outbox: EmailOutbox = emailOutbox,
  ) {}

  async handle(event: ChatIntentEvent): Promise<void> {
    if (event.type !== 'chat.intent.detected') return;
    if (event.intent.primary !== 'send_email' || event.intent.status !== 'clear') return;
    if (this.processed.has(event.id)) return;

    this.processed.add(event.id);

    const recipient = findParameter(event, ['recipient', 'to', 'email']);
    const body = findParameter(event, ['body', 'message', 'content']);
    const subject = findParameter(event, ['subject', 'title']) ?? '';
    const ccValue = findParameter(event, ['cc', 'copy']);
    const cc = ccValue
      ? ccValue
          .split(/[,;]/)
          .map((value) => value.trim())
          .filter((value) => EMAIL_PATTERN.test(value))
      : [];

    const base = {
      cc,
      subject,
      body: body ?? '',
      sessionId: event.sessionId,
      messageId: event.messageId,
    };

    if (!recipient) {
      this.record(event, {
        ...base,
        to: '',
        status: 'needs_info',
        reason: 'Recipient email address is missing.',
      });
      return;
    }

    if (!EMAIL_PATTERN.test(recipient)) {
      this.record(event, {
        ...base,
        to: recipient,
        status: 'needs_info',
        reason: 'Recipient is not a valid email address.',
      });
      return;
    }

    if (!body) {
      this.record(event, {
        ...base,
        to: recipient,
        status: 'needs_info',
        reason: 'Email body is missing.',
      });
      return;
    }

    try {
      const { id } = await this.sender.send({
        to: recipient,
        cc: cc.length > 0 ? cc : undefined,
        subject,
        body,
      });

      this.outbox.add({
        id,
        to: recipient,
        cc,
        subject,
        body,
        sentAt: new Date().toISOString(),
        sessionId: event.sessionId,
        messageId: event.messageId,
        status: 'sent',
      });
    } catch (error) {
      this.record(event, {
        ...base,
        to: recipient,
        status: 'failed',
        reason: error instanceof Error ? error.message : 'Email sending failed.',
      });
    }
  }

  private record(
    event: ChatIntentEvent,
    details: Omit<SentEmailRecord, 'id' | 'sentAt'>,
  ): void {
    this.outbox.add({
      ...details,
      id: randomUUID(),
      sentAt: new Date().toISOString(),
      sessionId: event.sessionId,
      messageId: event.messageId,
    });
  }
}

export const emailWorker = new EmailWorker();
