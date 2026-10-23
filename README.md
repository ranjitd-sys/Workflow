# Workflow Execution

A TypeScript monorepo that turns natural-language chat messages into validated
action identifiers and executes the implemented email workflow.

The repository has four parts:

- an Astro SSR **chat front-end** that asks clarifying questions, collects
  missing fields, confirms, and polls execution status;
- a **Bun HTTP server** that owns action identification, the workflow runtime,
  the in-memory queue, the server-side root machine, and Brevo delivery;
- a framework-free **action engine** that identifies an action and extracts
  parameters;
- a **workflow package** with the XState v5 client conversation machine and
  shared workflow contracts.

Immediate `send_email` execution goes through the Bun API, an in-memory workflow
queue, a server-side XState root machine, and a Brevo actor. `schedule_email` is
identified and has a placeholder server state, but scheduled delivery is not
implemented yet.

## Prerequisites

- Node.js 22+
- Bun 1.3+
- npm (the repository uses npm workspaces)

## Quick start

```bash
npm install
cp server/.env.example server/.env
npm run dev
```

`npm run dev` starts:

- the Astro front-end at http://localhost:4321;
- the Bun API at http://127.0.0.1:3001.

The Astro dev server proxies relative `/api` requests to the Bun API. Open
http://localhost:4321.

Minimum configuration for real classification in `server/.env`:

```env
GROQ_API_KEY=gsk_...
ACTION_LLM_BASE_URL=https://api.groq.com/openai/v1
ACTION_LLM_MODEL=openai/gpt-oss-20b
ACTION_LLM_MOCK=false
```

Brevo sending also requires:

```env
BREVO_API_KEY=xkeysib-...
BREVO_SENDER_EMAIL=verified-sender@example.com
BREVO_SENDER_NAME=Your Name
```

Without an LLM key, the app uses a local mock classifier. Without Brevo
credentials, action identification and confirmation still work, but the queued
`send_email` job fails with `BREVO_API_KEY is not configured.`

## Repository layout

```text
.
├── front-end/            Astro SSR UI and browser-side helpers
├── server/               Bun HTTP API and all server-only workflow code
├── packages/action-engine/
├── workflow/             Client conversation machine + shared contracts
└── scripts/dev.ts        Runs the front-end and API together
```

## Supported actions

| Action | Status | Required parameters |
|---|---|---|
| `send_email` | Identified, confirmed, queued, and executed | `to`, `subject`, `body` |
| `schedule_email` | Identified; server state is a placeholder | `to`, `subject`, `body`, `send_at` |

## Flow

1. User types a message.
2. The front-end identifies an action identifier and parameters through the Bun API.
3. Ambiguous or unknown results ask a clarifying question.
4. Clear `send_email` results start the client XState conversation machine.
5. The machine collects missing fields and asks for explicit confirmation.
6. On confirmation, Chat calls `POST /api/workflow/events` with the complete action.
7. The Bun runtime enqueues a `workflow.action.requested` event in an in-memory FIFO queue.
8. The server-side root workflow machine consumes the queue serially and routes `send_email` to the Brevo actor.
9. Chat polls `GET /api/workflow/events/:eventId` and renders the success or failure result.

The queue is in-memory and single-process. Jobs are lost when the Bun server
restarts. Only complete, confirmed actions are queued; the raw
`chat.action.identified` event is not an execution command.

A direct `POST /api/email` route remains available for low-level debugging, but
the chat UI uses the workflow queue.

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Bun API health check |
| `POST` | `/api/chat/action` | Identify an action from a chat message |
| `POST` | `/api/workflow/events` | Validate and enqueue a confirmed action |
| `GET` | `/api/workflow/events/:eventId` | Read workflow job status and result |
| `POST` | `/api/email` | Direct debug send, bypassing the queue |

The browser uses relative `/api` paths. In development, Astro proxies them to
the Bun server. In production, put both processes behind a reverse proxy that
serves the front-end and forwards `/api` to the Bun server, or configure an
equivalent production proxy.

## Tests

```bash
npm test
npm run typecheck
npm run build
```

Current suite: 65 tests across the action engine, workflow package, Bun server,
and front-end.

For the full system design, see [docs/SYSTEM_DIAGRAM.md](docs/SYSTEM_DIAGRAM.md).
