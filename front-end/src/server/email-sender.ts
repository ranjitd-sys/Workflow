import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import { env } from './env';

export interface OutgoingEmail {
  to: string;
  cc?: string[];
  subject: string;
  body: string;
}

export interface EmailSender {
  send(message: OutgoingEmail): Promise<{ id: string }>;
}

/** In-memory sender for local development. No email is actually delivered. */
export class MockEmailSender implements EmailSender {
  async send(_message: OutgoingEmail): Promise<{ id: string }> {
    return { id: randomUUID() };
  }
}

export interface MailTransport {
  sendMail(options: {
    from: string;
    to: string;
    cc?: string[];
    subject: string;
    text: string;
  }): Promise<{ messageId?: string }>;
}

export interface SmtpEmailSenderOptions {
  from: string;
  /** Optional full SMTP URL, e.g. smtps://user:pass@smtp.gmail.com:465 */
  url?: string;
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string;
}

function createTransport(options: SmtpEmailSenderOptions): MailTransport {
  if (options.url) {
    return nodemailer.createTransport(options.url) as unknown as MailTransport;
  }

  return nodemailer.createTransport({
    host: options.host ?? 'smtp.gmail.com',
    port: options.port ?? 465,
    secure: options.secure ?? true,
    auth:
      options.user && options.pass
        ? { user: options.user, pass: options.pass }
        : undefined,
  }) as unknown as MailTransport;
}

/** Sends email through a real SMTP server, e.g. Gmail. */
export class SmtpEmailSender implements EmailSender {
  private readonly transporter: MailTransport;

  constructor(
    private readonly options: SmtpEmailSenderOptions,
    transporter?: MailTransport,
  ) {
    this.transporter = transporter ?? createTransport(options);
  }

  async send(message: OutgoingEmail): Promise<{ id: string }> {
    const info = await this.transporter.sendMail({
      from: this.options.from,
      to: message.to,
      cc: message.cc,
      subject: message.subject,
      text: message.body,
    });

    return { id: info.messageId ?? randomUUID() };
  }
}

/** Used when SMTP is selected but required configuration is missing. */
class MisconfiguredEmailSender implements EmailSender {
  constructor(private readonly reason: string) {}

  async send(): Promise<{ id: string }> {
    throw new Error(this.reason);
  }
}

export type EnvReader = (key: string) => string | undefined;

function numberFrom(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Select the sender from environment configuration.
 *
 * Defaults to the mock sender. Set EMAIL_PROVIDER=smtp for Gmail:
 *   SMTP_HOST=smtp.gmail.com
 *   SMTP_PORT=465
 *   SMTP_SECURE=true
 *   SMTP_USER=you@gmail.com
 *   SMTP_PASS=<Google App Password>
 *   EMAIL_FROM=you@gmail.com
 */
export function createEmailSender(getEnv: EnvReader = env): EmailSender {
  const provider = (getEnv('EMAIL_PROVIDER') ?? 'mock').toLowerCase();

  if (provider !== 'smtp') {
    return new MockEmailSender();
  }

  const user = getEnv('SMTP_USER') ?? '';
  const pass = getEnv('SMTP_PASS') ?? '';
  const url = getEnv('SMTP_URL');
  const from = getEnv('EMAIL_FROM') ?? user;

  if (!from) {
    return new MisconfiguredEmailSender(
      'EMAIL_FROM (or SMTP_USER) must be set for EMAIL_PROVIDER=smtp.',
    );
  }

  if (!url && (!user || !pass)) {
    return new MisconfiguredEmailSender(
      'SMTP_USER and SMTP_PASS must be set for EMAIL_PROVIDER=smtp.',
    );
  }

  return new SmtpEmailSender({
    from,
    url,
    host: getEnv('SMTP_HOST') ?? 'smtp.gmail.com',
    port: numberFrom(getEnv('SMTP_PORT'), 465),
    secure: (getEnv('SMTP_SECURE') ?? 'true') !== 'false',
    user,
    pass,
  });
}

export type EmailStatus = 'sent' | 'needs_info' | 'failed';

export interface SentEmailRecord {
  id: string;
  to: string;
  cc: string[];
  subject: string;
  body: string;
  sentAt: string;
  sessionId: string;
  messageId?: string;
  status: EmailStatus;
  reason?: string;
}

/** In-memory outbox used by the worker to report send results. */
export class EmailOutbox {
  private readonly records: SentEmailRecord[] = [];

  add(record: SentEmailRecord): void {
    this.records.push(record);
  }

  list(sessionId?: string): SentEmailRecord[] {
    return sessionId
      ? this.records.filter((record) => record.sessionId === sessionId)
      : [...this.records];
  }

  clear(): void {
    this.records.length = 0;
  }
}

export const emailSender: EmailSender = createEmailSender();
export const emailOutbox = new EmailOutbox();
