# Architecture

See [SYSTEM_DIAGRAM.md](./SYSTEM_DIAGRAM.md) for the complete system diagram,
and [ACTION_ENGINE_DIAGRAM.md](./ACTION_ENGINE_DIAGRAM.md) for the detailed
action-identification diagrams.

## Purpose and boundaries

The system has three responsibilities:

1. **Identify** a user message as a validated action identifier and parameters.
2. **Publish** an identification event when the result is clear.
3. **Execute** confirmed actions through a server-side workflow queue.

The action engine never executes actions or calls external APIs. Chat owns the
clarification and confirmation conversation. Confirmed, complete actions are
sent to the Bun HTTP API, queued in memory, and consumed by a server-side XState
root machine. The root machine invokes an actor; the `send_email` actor calls
Brevo. `schedule_email` has a placeholder state and fails intentionally.

## High-level flow

```text
User message
  -> Astro chat UI
  -> POST /api/chat/action (relative URL, proxied by Astro in development)
  -> Bun HTTP API
  -> ActionEngine
  -> LLM
  -> ActionEventPublisher
  -> FanOutEventSink
     -> InMemoryEventSink
  -> Action card / clarification in UI

Clear send_email
  -> client XState conversation machine
  -> collect missing fields
  -> explicit confirmation
  -> POST /api/workflow/events
  -> Bun workflow runtime singleton
  -> InMemoryWorkflowQueue
  -> server-side root workflow machine
  -> send_email actor
  -> Brevo adapter
  -> POST https://api.brevo.com/v3/smtp/email
  -> GET /api/workflow/events/:eventId (polling)
  -> EXECUTION_SUCCEEDED / EXECUTION_FAILED
```

The raw `chat.action.identified` event is for identification only. Execution is
requested by a separate `workflow.action.requested` event created after user
confirmation.

## Repository layout

```text
.
├── front-end/
│   ├── src/components/chat/Chat.tsx
│   ├── src/lib/action.ts
│   ├── src/lib/chat/send-email-conversation-machine.ts
│   ├── src/lib/workflow.ts
│   ├── src/pages/index.astro
│   └── test/
├── server/
│   ├── src/index.ts                 Bun.serve route table
│   ├── src/action.ts                action-engine wiring
│   ├── src/actions/                 catalog + mock classifier
│   ├── src/env.ts                   process.env lookup
│   ├── src/email/                   Brevo adapter + config
│   ├── src/http/json.ts             JSON request/response helpers
│   ├── src/routes/                  Bun route handlers
│   ├── src/workflow/runtime.ts      process-wide singleton
│   ├── src/workflow/root-machine.ts server root machine
│   ├── src/workflow/queue/          in-memory queue
│   ├── src/workflow/actors/         send + schedule actors
│   └── test/
├── packages/action-engine/
├── workflow/
│   ├── src/contracts/workflow.ts    shared event/job/action contracts
│   ├── src/core/create-email-workflow.ts
│   ├── src/core/types.ts
│   ├── src/email/send-email.workflow.ts
│   └── test/send-email.test.ts
└── scripts/dev.ts
```

The `workflow` package contains only the browser conversation machine and
shared contracts. Server-only code never lives in `front-end/` or `workflow/`.

## Action identification

The engine uses a closed action catalog supplied by the application. The model returns:

```ts
{
  action: { identifier, status, alternatives, summary },
  parameters,
  missing,
  assumptions,
  ambiguities
}
```

Only clear actions publish `chat.action.identified` events. Ambiguous and unknown
results stay in the UI for clarification.

The catalog lives in `server/src/actions/definitions.ts`. The Bun action route
uses `createActionPublisher()` from `server/src/action.ts`; it selects the Groq
provider or the local mock provider based on `server/.env`.

## Confirmation and queueing

`Chat.tsx` creates one client XState actor from `createSendEmailConversationMachine()` and
maps identification results into machine events:

- missing required fields -> `collecting`;
- all required fields -> `confirming`;
- user confirmation -> `CONFIRM`;
- queue/poll success or failure -> `EXECUTION_SUCCEEDED` / `EXECUTION_FAILED`.

The client conversation machine is pure and framework-free. After `CONFIRM`, Chat calls
`enqueueWorkflowAction()` and then `waitForWorkflowJob()` from
`front-end/src/lib/workflow.ts`. Both use relative `/api` URLs.

The browser session is not persisted. Refreshing the page loses a pending
confirmation and the machine returns to `idle`.

## Bun HTTP API

`server/src/index.ts` starts a Bun HTTP server on `HOST:PORT` (default
`127.0.0.1:3001`). It owns:

- `GET /health`;
- `POST /api/chat/action`;
- `POST /api/workflow/events`;
- `GET /api/workflow/events/:eventId`;
- `POST /api/email`.

Route handlers live in `server/src/routes/` and use the shared helpers in
`server/src/http/json.ts`. The server loads `server/.env` when started from the
`server` workspace (for example through `npm run dev:server`).

In development, `front-end/astro.config.mjs` proxies `/api` to
`http://127.0.0.1:3001` (override with `API_PROXY_TARGET`). The Astro production
server does not include that proxy automatically; production deployment needs a
reverse proxy or equivalent same-origin routing.

## Server workflow runtime

`server/src/workflow/runtime.ts` owns a process-wide singleton stored on
`globalThis.__workflowRuntime`. It contains:

- one `InMemoryWorkflowQueue`;
- one started root machine actor;
- the Brevo configuration injected into the root machine.

The runtime exposes `enqueueWorkflowAction()` and `getWorkflowJob()`. The
singleton prevents duplicate queue listeners and actors during development
reloads.

### Execution event

```ts
{
  id: string;
  type: 'workflow.action.requested';
  version: 1;
  occurredAt: string;
  actionId: 'send_email' | 'schedule_email';
  parameters: Record<string, string>;
  sessionId?: string;
  sourceEventId?: string;
  source: 'chat';
}
```

Only actions with all required parameters from `APP_ACTIONS` are accepted by
`POST /api/workflow/events`.

### Queue and root machine

`InMemoryWorkflowQueue` is FIFO, deduplicates by event ID, and stores job state
(`queued`, `running`, `succeeded`, `failed`). The root machine in
`workflow/src/server/root-machine.ts`:

1. subscribes to queue notifications with `fromCallback`;
2. dequeues one event at a time;
3. marks the job `running`;
4. routes to `send_email` or `schedule_email`;
5. invokes the matching actor;
6. records success or failure;
7. returns to `idle` and wakes itself for the next queued job.

The `send_email` actor calls the Brevo adapter. The `schedule_email` actor always
throws `ScheduleNotImplementedError`.

### Brevo actor

`workflow/src/server/actors/send-email.actor.ts` receives the queued event plus
an injected `BrevoConfig`. It validates that `to`, `subject`, and `body` are
present, then calls `sendTransactionalEmail()` in `server/src/email/brevo.ts`.

The adapter validates configuration and input, sends the plain-text email, and
maps failures to `BrevoApiError`. `server/src/email/config.ts` reads the Brevo
values from `process.env`; secrets never reach the browser.

### Status polling

Chat polls `GET /api/workflow/events/:eventId` every 750 ms for up to 30 seconds.
A missing job returns `404`, which the client reports as:

> Workflow job not found. The server may have restarted.

## Direct email endpoint

`POST /api/email` remains a lower-level debug route that validates and sends one
email immediately through the Bun server. The chat UI no longer uses it. The
queue path is the primary execution path.

## Queue limitations

- In-memory only; pending and completed jobs are lost on restart.
- Single process only; multiple Bun instances do not share a queue.
- Serial processing; one actor invocation at a time.
- No retry, cancellation, or persistence yet.
- No authentication or rate limiting on the workflow endpoints yet.

## Security boundaries

- Authentication is client-only and stored in `localStorage`.
- `POST /api/workflow/events`, `GET /api/workflow/events/:eventId`, and
  `POST /api/email` are unauthenticated in this phase.
- LLM and Brevo credentials stay server-side in `server/.env`.
- The Bun API should not be exposed publicly without authentication and rate
  limiting.
