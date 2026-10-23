import { handleChatAction } from './routes/chat-action';
import { handleDirectEmail } from './routes/email';
import { handleWorkflowEvents } from './routes/workflow-events';
import { handleWorkflowStatus } from './routes/workflow-status';

export function createServer() {
  return Bun.serve({
    hostname: process.env.HOST ?? '127.0.0.1',
    port: Number(process.env.PORT ?? 3001),
    routes: {
      '/health': {
        GET: () => Response.json({ ok: true }),
      },
      '/api/chat/action': {
        POST: handleChatAction,
      },
      '/api/workflow/events': {
        POST: handleWorkflowEvents,
      },
      '/api/workflow/events/:eventId': {
        GET: (request) => {
          const eventId = new URL(request.url).pathname.split('/').filter(Boolean).at(-1);
          return handleWorkflowStatus(eventId);
        },
      },
      '/api/email': {
        POST: handleDirectEmail,
      },
    },
    fetch() {
      return Response.json({ error: 'Not found.' }, { status: 404 });
    },
  });
}

if (import.meta.main) {
  const server = createServer();
  console.log(`Workflow API listening on ${server.url}`);
}
