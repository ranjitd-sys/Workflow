# Workflow Execution

A TypeScript monorepo that turns natural-language chat messages into validated
action identifiers and executes the implemented email workflow.

The repository has four parts:

- an Astro SSR **chat front-end** that asks clarifying questions, collects
  missing fields, confirms, and polls execution status;
- a **Bun API server** that serves public endpoints and identifies actions;
- a **Bun workflow service** that owns the in-memory queue, runtime, main
  machine, actors, and Brevo delivery;
- an **action engine** package that identifies actions and extracts parameters.

Immediate `send_email` execution goes through the API server, the workflow
service, the in-memory queue, the main workflow machine, and a Brevo actor.
`schedule_email` is identified and has a placeholder actor, but scheduled
delivery is not implemented yet.

## Prerequisites

- Node.js 22+
- Bun 1.3+
- npm (the repository uses npm workspaces)

## Quick start

```bash
npm install
cp server/.env.example server/.env
cp workflow/.env.example workflow/.env
npm run dev
```

`npm run dev` starts:

- the Astro front-end at http://localhost:4321;
- the Bun API server at http://127.0.0.1:3001;
- the Bun workflow service at http://127.0.0.1:3002.

The Astro dev server proxies relative `/api` requests to the API server. The
API server proxies workflow execution requests to the workflow service. Open
http://localhost:4321.

Minimum configuration for real action identification in `server/.env`:

```env
GROQ_API_KEY=gsk_...
ACTION_LLM_BASE_URL=https://api.groq.com/openai/v1
ACTION_LLM_MODEL=openai/gpt-oss-20b
ACTION_LLM_MOCK=false
```

Brevo sending requires the workflow service configuration in `workflow/.env`:

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
├── front-end/            Astro SSR UI + client conversation machine
├── server/               Bun public API + action identification + workflow proxy
├── workflow/             Queue, runtime, main machine, actors, Brevo service
├── packages/action-engine/
└── scripts/dev.ts        Runs front-end, API server, and workflow service
```

## Public API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | API server health check |
| `POST` | `/api/chat/action` | Identify an action from a chat message |
| `POST` | `/api/workflow/events` | Validate and proxy an enqueue request |
| `GET` | `/api/workflow/events/:eventId` | Proxy workflow job status |
| `POST` | `/api/email` | Proxy the direct debug send endpoint |

The workflow service exposes matching internal routes under
`/internal/...` on port 3002. It is not intended for public traffic.

In development, Astro proxies `/api` to the API server. In production, put the
front-end and API behind a reverse proxy and keep the workflow service on a
private network.

## Flow

1. User types a message.
2. The front-end identifies an action through the API server.
3. Ambiguous or unknown results ask a clarifying question.
4. Clear `send_email` results start the client conversation machine.
5. The machine collects missing fields and asks for explicit confirmation.
6. On confirmation, Chat calls `POST /api/workflow/events`.
7. The API server validates the action and proxies it to the workflow service.
8. The workflow service enqueues a `workflow.action.requested` event.
9. The main machine dequeues serially and invokes the actor matching `actionId`.
10. Chat polls `GET /api/workflow/events/:eventId` and renders the result.

The workflow queue is in-memory and single-process. Jobs are lost when the
**workflow service** restarts; restarting only the API server does not remove
jobs. Multiple workflow instances do not share jobs or status.

## Tests

```bash
npm test
npm run typecheck
npm run build
```

Current suite: 70 tests across the action engine, workflow service, API server,
and front-end.

For the full system design, see [docs/SYSTEM_DIAGRAM.md](docs/SYSTEM_DIAGRAM.md).
