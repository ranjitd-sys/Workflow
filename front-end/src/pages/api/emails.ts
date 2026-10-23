import type { APIRoute } from 'astro';
import { emailOutbox } from '../../server/email-sender';

/** Debug/demo endpoint: inspect emails recorded by the mock sender and worker. */
export const GET: APIRoute = async ({ url }) => {
  const sessionId = url.searchParams.get('sessionId') ?? undefined;
  const emails = emailOutbox.list(sessionId);

  return new Response(JSON.stringify({ count: emails.length, emails }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
