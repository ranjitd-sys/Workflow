import { BrevoApiError, sendTransactionalEmail } from '../email/brevo';
import { getBrevoConfig } from '../email/config';
import { isRecord, json, readJson } from '../http/json';

interface EmailRequestBody {
  actionId: 'send_email';
  parameters: {
    to: string;
    subject: string;
    body: string;
  };
}

function parseBody(body: unknown): EmailRequestBody | null {
  if (!isRecord(body)) return null;
  if (body.actionId !== 'send_email') return null;
  if (!isRecord(body.parameters)) return null;

  const { to, subject, body: emailBody } = body.parameters;
  if (typeof to !== 'string' || typeof subject !== 'string' || typeof emailBody !== 'string') {
    return null;
  }

  return {
    actionId: 'send_email',
    parameters: {
      to,
      subject,
      body: emailBody,
    },
  };
}

export async function handleDirectEmail(request: Request): Promise<Response> {
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;

  const input = parseBody(parsed.body);
  if (!input) {
    return json(
      {
        error:
          'Body must include actionId "send_email" and parameters to, subject, and body.',
      },
      400,
    );
  }

  try {
    const result = await sendTransactionalEmail(input.parameters, getBrevoConfig());
    return json({ status: 'sent', messageId: result.messageId });
  } catch (error) {
    if (error instanceof BrevoApiError) {
      return json({ error: error.message }, error.status);
    }
    return json(
      { error: error instanceof Error ? error.message : 'Email send failed.' },
      500,
    );
  }
}
