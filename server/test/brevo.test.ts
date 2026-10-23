import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendTransactionalEmail, type BrevoConfig } from '../src/email/brevo';

const config: BrevoConfig = {
  apiKey: 'test-key',
  senderEmail: 'sender@example.com',
  senderName: 'Sender',
};

describe('sendTransactionalEmail', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends a Brevo transactional email and returns messageId', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 201,
      json: async () => ({ messageId: 'msg-123' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendTransactionalEmail(
      {
        to: 'john@acme.com',
        subject: 'Invoice',
        body: 'Please find the invoice attached.',
      },
      config,
    );

    expect(result.messageId).toBe('msg-123');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(init?.headers).toMatchObject({ 'api-key': 'test-key' });
    expect(JSON.parse(String(init?.body)).textContent).toBe('Please find the invoice attached.');
  });

  it('throws for invalid recipient', async () => {
    await expect(
      sendTransactionalEmail(
        {
          to: 'not-an-email',
          subject: 'Invoice',
          body: 'Body',
        },
        config,
      ),
    ).rejects.toThrow('invalid');
  });

  it('maps Brevo HTTP errors to BrevoApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ message: 'bad request', code: 'invalid_parameter' }),
      })),
    );

    await expect(
      sendTransactionalEmail(
        {
          to: 'john@acme.com',
          subject: 'Invoice',
          body: 'Body',
        },
        config,
      ),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_parameter' });
  });
});
