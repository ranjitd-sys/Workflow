export interface BrevoConfig {
  apiKey?: string;
  senderEmail?: string;
  senderName?: string;
}

export class BrevoApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'BrevoApiError';
    this.status = status;
    this.code = code;
  }
}

interface BrevoSendResponse {
  messageId?: string;
  messageIds?: string[];
}

function validateEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function sendTransactionalEmail(
  input: {
    to: string;
    subject: string;
    body: string;
  },
  config: BrevoConfig,
): Promise<{ messageId: string }> {
  const apiKey = config.apiKey;
  const senderEmail = config.senderEmail?.trim();
  const senderName = config.senderName;
  const recipient = input.to.trim();

  if (!apiKey) {
    throw new BrevoApiError('BREVO_API_KEY is not configured.', 500, 'missing_api_key');
  }
  if (!senderEmail || !validateEmail(senderEmail)) {
    throw new BrevoApiError('BREVO_SENDER_EMAIL must be a valid email address.', 500, 'missing_sender');
  }
  if (!validateEmail(recipient)) {
    throw new BrevoApiError('The recipient email address is invalid.', 400, 'invalid_recipient');
  }
  if (!input.subject.trim()) {
    throw new BrevoApiError('The email subject is required.', 400, 'missing_subject');
  }
  if (!input.body.trim()) {
    throw new BrevoApiError('The email body is required.', 400, 'missing_body');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        sender: {
          email: senderEmail,
          name: senderName?.trim() || undefined,
        },
        to: [{ email: recipient }],
        subject: input.subject,
        textContent: input.body,
      }),
      signal: controller.signal,
    });

    const payload = (await response.json().catch(() => ({}))) as BrevoSendResponse & {
      message?: string;
      code?: string;
    };

    if (!response.ok) {
      throw new BrevoApiError(
        payload.message ?? `Brevo returned HTTP ${response.status}.`,
        response.status,
        payload.code,
      );
    }

    const messageId = payload.messageId ?? payload.messageIds?.[0];
    if (!messageId) {
      throw new BrevoApiError('Brevo did not return a message ID.', 502, 'missing_message_id');
    }

    return { messageId };
  } catch (error) {
    if (error instanceof BrevoApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new BrevoApiError('Brevo request timed out.', 504, 'timeout');
    }
    throw new BrevoApiError('Failed to reach Brevo.', 502, 'network_error');
  } finally {
    clearTimeout(timeout);
  }
}
