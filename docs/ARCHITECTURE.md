# Architecture

See [SYSTEM_DIAGRAM.md](./SYSTEM_DIAGRAM.md) for the complete system diagram,
and [ACTION_ENGINE_DIAGRAM.md](./ACTION_ENGINE_DIAGRAM.md) for the detailed
action-identification diagrams.

## Purpose and boundaries

The system has three responsibilities:

1. **Identify** a user message as a validated action identifier and parameters.
2. **Serve** public API endpoints for the chat front-end.
3. **Execute** confirmed actions through a standalone workflow service.

The action engine never executes actions or calls external APIs. The public Bun
API server owns action identification and endpoint handling. Confirmed actions
are proxied to the workflow service, queued in memory, and consumed serially by
the main workflow machine. The main machine invokes the actor matching
`event.actionId`; the `send_email` actor calls Brevo. `schedule_email` has a
placeholder actor that fails intentionally.

## High-level flow

```text
User message
  -> Astro chat UI
  -> POST /api/chat/action (proxied by Astro in development)
  -> Bun API server
  -> ActionEngine
  -> LLM or mock
  -> ActionEventPublisher
  -> InMemoryEventSink
  -> Action card / clarification in UI

Clear send_email
  -> client conversation machine
  -> collect missing fields
  -> explicit confirmation
  -> POST /api/workflow/events
  -> Bun API server validates the action
  -> POST /internal/workflow/events
  -> workflow service
  -> InMemoryWorkflowQueue
  -> main workflow machine
  -> actor registry[event.actionId]
  -> send_email actor
  -> Brevo adapter
  -> GET /api/workflow/events/:eventId (polling)
  -> job status response
```

The raw identification event is not an execution command. Execution is
requested by a separate `workflow.action.requested` event created after user
confirmation.

## Repository layout

```text
.
├── front-end/
│   ├── src/components/chat/Chat.tsx
│   ├── src/lib/action.ts
│   ├── src/lib/chat/send-email-conversation-machine.ts
│   ├── src/lib/chat/send-email-conversation-types.ts
│   ├── src/lib/workflow.ts
│   ├── src/pages/index.astro
│   └── test/
├── server/
│   ├── src/index.ts                  Bun.serve public API
│   ├── src/action.ts                 action-engine wiring
│   ├── src/actions/                  catalog + mock classifier
│   ├── src/env.ts                    process.env lookup
│   ├── src/http/json.ts              JSON helpers
│   ├── src/routes/                   public HTTP handlers
│   ├── src/workflow-client.ts        proxy to the workflow service
│   └── test/
├── workflow/
│   ├── src/contracts/workflow.ts     shared contracts
│   ├── src/server/service.ts         standalone Bun workflow service
│   ├── src/server/runtime.ts         queue + runtime singleton
│   ├── src/server/main-machine.ts    main XState machine
│   ├── src/server/queue/             in-memory queue
│   ├── src/server/actors/            actor registry + send/schedule actors
│   ├── src/server/email/             Brevo transport + config
│   └── test/server/
├── packages/action-engine/
└── scripts/dev.ts
```

The front-end owns the client conversation machine and performs no workflow
execution. The API server owns public endpoints and action identification. The
workflow service owns all execution state.

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

The catalog lives in `server/src/actions/definitions.ts`. The API route uses
`createActionPublisher()` from `server/src/action.ts`; it selects the Groq
provider or the local mock provider based on `server/.env`.

## Confirmation and queueing

`Chat.tsx` creates one client XState actor from
`createSendEmailConversationMachine()` and maps identification results into
machine events:

- missing required fields -> `collecting`;
- all required fields -> `confirming`;
- user confirmation -> `CONFIRM`;
- queue/poll success or failure -> `EXECUTION_SUCCEEDED` / `EXECUTION_FAILED`.

The client conversation machine is pure and framework-free. After `CONFIRM`,
Chat calls `enqueueWorkflowAction()` and then `waitForWorkflowJob()` from
`front-end/src/lib/workflow.ts`. Both use relative `/api` URLs.

The browser session is not persisted. Refreshing the page loses a pending
confirmation and the machine returns to `idle`.

## Public API server

`server/src/index.ts` starts a Bun HTTP server on `HOST:PORT` (default
`127.0.0.1:3001`). It owns:

- `GET /health`;
- `POST /api/chat/action`;
- `POST /api/workflow/events`;
- `GET /api/workflow/events/:eventId`;
- `POST /api/email`.

The workflow routes validate the action and parameters using `APP_ACTIONS`, then
delegate to `server/src/workflow-client.ts`. If the workflow service is
unavailable, the public API returns `502`.

The API server loads `server/.env` when started from the `server` workspace.

In development, `front-end/astro.config.mjs` proxies `/api` to the API server
(override with `API_PROXY_TARGET`). The Astro production server does not include
that proxy automatically; production needs a reverse proxy or equivalent
same-origin routing.

## Workflow service

`workflow/src/server/service.ts` starts a Bun HTTP service on `HOST:PORT`
(default `127.0.0.1:3002`). Its internal endpoints are:

- `GET /health`;
- `POST /internal/workflow/events`;
- `GET /internal/workflow/events/:eventId`;
- `POST /internal/email`.

The service loads `workflow/.env` when started from the `workflow` workspace. It
is intended to run on a private network and is not exposed to the browser.

The service can later be packaged as its own Docker image. With the in-memory
queue there must be only one workflow instance for consistent job/status
behavior. Horizontal scaling requires shared state such as Redis or sticky
routing.

## Workflow runtime

`workflow/src/server/runtime.ts` owns a process-wide singleton stored on
`globalThis.__workflowRuntime`. It contains:

- one `InMemoryWorkflowQueue`;
- one started main workflow machine;
- an actor registry containing the send and schedule actors.

The runtime exposes `enqueueWorkflowAction()` and `getWorkflowJob()`.

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

### Queue and main machine

`InMemoryWorkflowQueue` is FIFO, deduplicates by event ID, and stores job state
(`queued`, `running`, `succeeded`, `failed`). The main machine in
`workflow/src/server/main-machine.ts`:

1. subscribes to queue notifications with `fromCallback`;
2. dequeues one event at a time;
3. marks the job `running`;
4. looks up `event.actionId` in the actor registry;
5. invokes the matching actor;
6. records success or failure;
7. returns to `idle` and wakes itself for the next queued job.

The actor registry lives in `workflow/src/server/actors/index.ts`:

```ts
{
  send_email: sendEmailActor,
  schedule_email: scheduleEmailActor,
}
```

### Brevo actor

`workflow/src/server/actors/send-email.actor.ts` validates that `to`, `subject`,
and `body` are present, then calls `sendTransactionalEmail()` in
`workflow/src/server/email/brevo.ts`.

The adapter validates configuration and input, sends the plain-text email, and
maps failures to `BrevoApiError`. `workflow/src/server/email/config.ts` reads the
Brevo values from `process.env`; secrets never reach the browser.

### Status polling

Chat polls `GET /api/workflow/events/:eventId` every 750 ms for up to 30 seconds.
The API server proxies the request to the workflow service. A missing job
returns `404`, which the client reports as:

> Workflow job not found. The server may have restarted.

## Direct email endpoint

`POST /api/email` remains a lower-level debug route. The API server proxies it to
the workflow service's `/internal/email` endpoint, which sends through Brevo
immediately and bypasses the queue. The chat UI does not use it.

## Queue limitations

- In-memory only; pending and completed jobs are lost when the workflow service restarts.
- Single workflow instance only; multiple instances do not share a queue.
- Serial processing; one actor invocation at a time.
- No retry, cancellation, or persistence yet.
- No authentication or rate limiting on the public workflow endpoints yet.

## Security boundaries

- Authentication is client-only and stored in `localStorage`.
- `POST /api/workflow/events`, `GET /api/workflow/events/:eventId`, and
  `POST /api/email` are unauthenticated in this phase.
- LLM credentials stay in `server/.env`; Brevo credentials stay in
  `workflow/.env`.
- The workflow service should remain on a private network.
- The public API should not be exposed without authentication and rate limiting.
