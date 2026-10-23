import { describe, expect, it, vi } from 'vitest';
import {
  MockEmailSender,
  SmtpEmailSender,
  createEmailSender,
  type MailTransport,
} from '../src/server/email-sender';

describe('SmtpEmailSender', () => {
  it('sends through the injected transport', async () => {
    const sendMail = vi.fn(async () => ({ messageId: 'smtp-1' }));
    const transport: MailTransport = { sendMail };

    const sender = new SmtpEmailSender(
      {
        from: 'me@gmail.com',
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        user: 'me@gmail.com',
        pass: 'app-password',
      },
      transport,
    );

    const result = await sender.send({
      to: 'john@acme.com',
      cc: ['cc@acme.com'],
      subject: 'Hi',
      body: 'Hello',
    });

    expect(result.id).toBe('smtp-1');
    expect(sendMail).toHaveBeenCalledWith({
      from: 'me@gmail.com',
      to: 'john@acme.com',
      cc: ['cc@acme.com'],
      subject: 'Hi',
      text: 'Hello',
    });
  });
});

describe('createEmailSender', () => {
  it('defaults to the mock sender', () => {
    const sender = createEmailSender(() => undefined);
    expect(sender).toBeInstanceOf(MockEmailSender);
  });

  it('creates an SMTP sender when Gmail credentials are configured', () => {
    const values: Record<string, string> = {
      EMAIL_PROVIDER: 'smtp',
      EMAIL_FROM: 'me@gmail.com',
      SMTP_USER: 'me@gmail.com',
      SMTP_PASS: 'app-password',
    };

    const sender = createEmailSender((key) => values[key]);
    expect(sender).toBeInstanceOf(SmtpEmailSender);
  });

  it('fails on send when SMTP is selected without credentials', async () => {
    const values: Record<string, string> = {
      EMAIL_PROVIDER: 'smtp',
      EMAIL_FROM: 'me@gmail.com',
    };

    const sender = createEmailSender((key) => values[key]);

    await expect(
      sender.send({ to: 'john@acme.com', subject: '', body: 'Hello' }),
    ).rejects.toThrow('SMTP_USER');
  });
});
