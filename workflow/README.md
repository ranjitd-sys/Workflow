# Workflow package

This package owns workflow contracts and the standalone workflow execution
service. The browser conversation machine lives in the front-end at
`front-end/src/lib/chat/send-email-conversation-machine.ts`.

## Shared contracts

`src/contracts/workflow.ts` exports action IDs, the
`workflow.action.requested` event shape, queue/job types, and the `WorkflowQueue`
interface. The package root (`src/index.ts`) exports only these browser-safe
contracts.

## Workflow service

`src/server/service.ts` starts the workflow service on `HOST:PORT` (default
`127.0.0.1:3002`). The service owns:

- the in-memory FIFO queue;
- the process-wide runtime singleton;
- the main workflow machine;
- the `send_email` and `schedule_email` actors;
- Brevo email transport and configuration.

Internal service endpoints:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Service health |
| `POST` | `/internal/workflow/events` | Enqueue a confirmed action |
| `GET` | `/internal/workflow/events/:eventId` | Read job status |
| `POST` | `/internal/email` | Direct debug email send |

The public Bun API in `server/` proxies these endpoints. The workflow service is
not intended to be exposed publicly.

```bash
npm run dev:workflow
npm run start:workflow
```

Configuration lives in `workflow/.env`; copy `workflow/.env.example` to start.

## Execution flow

```text
workflow action event
  -> main machine
  -> actor registry[event.actionId]
  -> send_email        -> Brevo
  -> schedule_email    -> placeholder failure
  -> job succeeded/failed in the in-memory queue
```

The queue is in-memory and single-process. Restarting the workflow service
removes all jobs. Multiple workflow instances do not share jobs or status;
horizontal scaling will require shared state such as Redis or sticky routing.

## Tests

```bash
npm test
```

Tests cover the main machine, in-memory queue, and Brevo adapter.
