# Entire System Diagram

This document describes the complete system: browser, authentication, chat UI,
the Astro SSR front-end, the Bun HTTP API, the action engine, events, LLM
provider, XState workflow machines, the in-memory execution queue, and Brevo
transactional email.

## Status legend

| Line style | Meaning |
|---|---|
| Solid | Implemented today |
| Dashed | Planned or not implemented |

Immediate `send_email` delivery is implemented through a Bun HTTP API, a
server-side XState root machine, an in-memory FIFO queue, and a Brevo actor. The
chat client keeps the clarification and confirmation conversation, then enqueues
a confirmed action. Scheduling has a placeholder root-machine state only.
Persistent records, retries, background workers, and server-side authentication
remain planned.

In development, the Astro front-end proxies relative `/api` requests to the Bun
API. The Astro production server does not include that proxy automatically;
production needs a reverse proxy or equivalent same-origin routing.

## 1. System context

```mermaid
flowchart LR
  User["User"] -->|"sign up / sign in"| App["Astro SSR front-end<br/>:4321"]
  App -->|"chat message<br/>/api proxy"| ActionAPI["Bun API<br/>POST /api/chat/action"]
  ActionAPI --> Engine["Action Engine package"]
  Engine -->|"structured prompt"| LLM["LLM provider"]
  Engine -->|"clear identification"| Events["Event layer"]
  Events -->|"in-memory"| EventStore["Event store"]

  App --> ChatMachine["Chat + client XState<br/>conversation machine"]
  ChatMachine -->|"confirmed action<br/>POST /api/workflow/events"| WorkflowAPI["Bun API<br/>workflow routes"]
  WorkflowAPI --> Queue["In-memory FIFO queue"]
  Queue --> RootMachine["Server-side root<br/>XState machine"]
  RootMachine -->|"send_email"| SendActor["Send email actor"]
  SendActor -->|"HTTPS"| Brevo["Brevo API"]
  RootMachine -->|"schedule_email"| ScheduleActor["Schedule actor<br/>placeholder"]
  ChatMachine -->|"poll job status"| WorkflowAPI

  DirectAPI["Bun API<br/>POST /api/email<br/>direct debug route"] --> SendActor
  Scheduler["Scheduler / worker<br/>planned"] -.-> SendActor
  EmailStore["Email and schedule store<br/>planned"] -.-> Scheduler
  SendActor -.-> EmailStore
```

### Event-to-Brevo workflow mapping

| Event | Emitted when | Execution |
|---|---|---|
| `chat.action.identified` | An action is identified as `clear` | None; identification only |
| `workflow.action.requested` | User confirms a complete action | Queued for the server root machine |

The raw identification event is not an execution command. Execution requires a
confirmed, complete action. `schedule_email` events are accepted by the queue but
fail in the placeholder actor.

## 2. Component architecture

```mermaid
flowchart TB
  subgraph Browser["Browser"]
    Page["pages/index.astro"]
    AuthGate["AuthGate.tsx"]
    Chat["Chat.tsx<br/>transcript + confirmation"]
    ClientMachine["client XState<br/>send-email-conversation-machine.ts"]
    ClientAction["lib/action.ts<br/>identifyAction()"]
    ClientWorkflow["lib/workflow.ts<br/>enqueue + poll"]
  end

  subgraph FrontEnd["Astro SSR front-end<br/>Node standalone :4321"]
    AstroPage["Astro pages"]
    Proxy["Vite dev proxy<br/>/api -> :3001"]
  end

  subgraph Server["Bun HTTP API :3001"]
    ActionAPI["POST /api/chat/action"]
    WorkflowAPI["POST /api/workflow/events"]
    StatusAPI["GET /api/workflow/events/:eventId"]
    HealthAPI["GET /health"]
    Runtime["server/src/workflow/runtime.ts<br/>global singleton"]
    QueueInstance["InMemoryWorkflowQueue"]
    RootInstance["root machine actor"]
    SendActor["server/src/workflow/actors/<br/>send-email.actor.ts"]
    ScheduleActor["server/src/workflow/actors/<br/>schedule-email.actor.ts"]
    BrevoAdapter["server/src/email/brevo.ts"]
    DirectEmailAPI["POST /api/email<br/>debug route"]
    Wiring["server/src/action.ts"]
    Publisher["ActionEventPublisher"]
    FanOut["FanOutEventSink"]
    EventStore["InMemoryEventSink"]
    Catalog["server/src/actions/definitions.ts"]
  end

  subgraph WorkflowPackage["@workflow-execution/workflow"]
    Contracts["shared event/job contracts"]
    ServerRoot["server root machine"]
    ServerActors["server actors"]
    BrevoAdapter["Brevo adapter"]
  end

  subgraph ActionPackage["@workflow-execution/action-engine"]
    Engine["ActionEngine.identify()"]
    Registry["ActionRegistry"]
    Context["prepareContext()"]
    Prompt["prompt.ts<br/>system prompt + schema"]
    Provider["StructuredLlmProvider"]
    OpenAI["OpenAiCompatibleProvider"]
    Validate["validateActionIdentification()"]
  end

  subgraph External["External systems"]
    LLM["LLM API<br/>Groq / OpenAI-compatible"]
    Brevo["Brevo API"]
  end

  Page --> AstroPage
  AstroPage --> AuthGate
  AuthGate --> Chat
  Chat --> ClientAction
  Chat --> ClientMachine
  Chat --> ClientWorkflow
  ClientMachine --> Contracts
  ClientWorkflow --> Contracts
  ClientAction -->|"POST /api/chat/action"| Proxy
  ClientWorkflow -->|"POST confirmed action"| Proxy
  ClientWorkflow -->|"poll status"| Proxy
  Proxy --> ActionAPI
  Proxy --> WorkflowAPI
  Proxy --> StatusAPI

  ActionAPI --> Wiring
  Wiring --> Catalog
  Wiring --> Engine
  Wiring --> Publisher
  Publisher --> Engine
  Engine --> Registry
  Engine --> Context
  Engine --> Prompt
  Engine --> Provider
  Engine --> Validate
  Provider --> OpenAI
  OpenAI --> LLM

  Publisher --> FanOut
  FanOut --> EventStore
  EventStore -->|"eventCount"| ActionAPI

  WorkflowAPI --> Runtime
  StatusAPI --> Runtime
  Runtime --> QueueInstance
  Runtime --> RootInstance
  QueueInstance -->|"notify"| RootInstance
  RootInstance -->|"dequeue"| QueueInstance
  RootInstance -->|"invoke"| SendActor
  RootInstance -->|"invoke"| ScheduleActor
  SendActor --> BrevoAdapter
  BrevoAdapter -->|"HTTPS"| Brevo
  DirectEmailAPI --> BrevoAdapter

```

## 3. Identification and clarification flow

Clear `send_email` results continue into the client conversation machine in
section 4. Clear `schedule_email` results stop at the action card.

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant Auth as AuthGate
  participant Chat as Chat.tsx
  participant Client as lib/action.ts
  participant API as Bun API<br/>POST /api/chat/action
  participant Wiring as server/src/action.ts
  participant Pub as ActionEventPublisher
  participant Engine as ActionEngine
  participant LLM as LLM or mock
  participant Sink as FanOutEventSink
  participant Store as InMemoryEventSink

  User->>Auth: Sign in
  Auth->>Auth: Read localStorage session
  Auth->>Chat: Render chat

  User->>Chat: Type message
  Chat->>Client: identifyAction(message, history, sessionId)
  Client->>API: POST JSON
  API->>Wiring: createActionPublisher(message)
  Wiring->>Wiring: choose provider, build engine and publisher
  Wiring-->>API: publisher + mock flag
  API->>Pub: handle(input)
  Pub->>Engine: identify(input)
  Engine->>Engine: truncate context, build prompt and schema
  Engine->>LLM: structured generation request
  LLM-->>Engine: JSON result
  Engine->>Engine: validate result

  alt status is clear
    Engine-->>Pub: clear result
    Pub->>Pub: build and validate event
    Pub->>Sink: emit(event)
    Sink->>Store: store event
    Pub-->>API: result + event
  else status is ambiguous or unknown
    Engine-->>Pub: ambiguous or unknown result
    Pub-->>API: result + null event
  end

  API-->>Client: result, event, mock, eventCount, supportedActions
  Client-->>Chat: ActionResponse

  alt status is clear
    Chat->>Chat: render ActionCard
  else status is ambiguous
    Chat->>Chat: render ClarificationCard with alternatives
  else status is unknown
    Chat->>Chat: ask what the user wants to do
  end

  Chat->>Chat: chooseOption() resolves selection locally
```

## 4. send_email flow (implemented)

`Chat.tsx` owns the client conversation state and the enqueue/poll effects. The
server root machine owns execution after the confirmed event is queued.

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant Chat as Chat.tsx
  participant Machine as client XState<br/>sendEmail machine
  participant ActionAPI as Bun API<br/>POST /api/chat/action
  participant WorkflowAPI as Bun API<br/>POST /api/workflow/events
  participant Runtime as Bun workflow runtime
  participant Queue as InMemoryWorkflowQueue
  participant Root as server root XState machine
  participant SendActor as workflow send_email actor
  participant Brevo as Brevo API
  participant StatusAPI as Bun API<br/>GET /api/workflow/events/:eventId

  User->>Chat: Send an email to john@acme.com
  Chat->>ActionAPI: identify message
  ActionAPI-->>Chat: clear send_email + missing subject, body
  Chat->>Machine: IDENTIFIED

  Machine->>Machine: collecting
  Machine-->>Chat: ask for subject
  Chat->>User: What should the subject be?
  User->>Chat: Invoice for March
  Chat->>Machine: PARAMETER_PROVIDED subject

  Machine-->>Chat: ask for body
  Chat->>User: What should the email say?
  User->>Chat: Please find the invoice attached.
  Chat->>Machine: PARAMETER_PROVIDED body

  Machine->>Machine: confirming
  Chat->>User: Confirm sending to john@acme.com?
  User->>Chat: Confirm and send
  Chat->>Machine: CONFIRM

  Chat->>WorkflowAPI: POST complete action
  WorkflowAPI->>Runtime: enqueueWorkflowAction()
  Runtime->>Queue: enqueue(workflow.action.requested)
  WorkflowAPI-->>Chat: 202 { eventId, status: queued }

  Queue-->>Root: notify QUEUE_WAKE
  Root->>Queue: dequeue next event
  Root->>Root: mark job running
  Root->>SendActor: invoke send_email
  SendActor->>Brevo: POST /v3/smtp/email
  Brevo-->>SendActor: 201 { messageId }
  SendActor-->>Root: { messageId }
  Root->>Queue: mark job succeeded

  loop poll until terminal state
    Chat->>StatusAPI: GET job status
    StatusAPI->>Runtime: getWorkflowJob(eventId)
    Runtime->>Queue: read job
    StatusAPI-->>Chat: status + messageId
  end

  Chat->>Machine: EXECUTION_SUCCEEDED
  Chat->>User: Email sent + message ID
```

If the actor fails, the root machine records `status: failed` and the error. Chat
sends `EXECUTION_FAILED` to the client machine.

## 5. Server root workflow machine (implemented)

The root machine lives in `workflow/src/server/root-machine.ts`. It is started
only by `server/src/runtime.ts` inside the Bun API process.

```mermaid
stateDiagram-v2
  [*] --> idle
  idle --> send_email: QUEUE_WAKE / dequeue send_email
  idle --> schedule_email: QUEUE_WAKE / dequeue schedule_email
  send_email --> completed: send actor done
  send_email --> failed: send actor error
  schedule_email --> failed: placeholder error
  completed --> idle: always / clear current job
  failed --> idle: always / clear current job
```

The queue listener wakes the machine whenever a job is enqueued. The machine
processes one job at a time and raises another wake-up after completion.

## 6. Client send-email conversation machine (implemented)

The client conversation machine lives in
`front-end/src/lib/chat/send-email-conversation-machine.ts`. `Chat.tsx` sends events into it
and performs the enqueue/poll effects after `CONFIRM`.

```mermaid
stateDiagram-v2
  [*] --> idle
  idle --> identifying: SUBMIT_MESSAGE
  identifying --> collecting: IDENTIFIED with missing fields
  identifying --> confirming: IDENTIFIED complete
  identifying --> clarifying: NEEDS_CLARIFICATION
  identifying --> failed: IDENTIFICATION_FAILED

  clarifying --> collecting: CLARIFICATION_CHOSEN with missing
  clarifying --> confirming: CLARIFICATION_CHOSEN complete
  clarifying --> identifying: SUBMIT_MESSAGE
  clarifying --> cancelled: CANCEL

  collecting --> collecting: PARAMETER_PROVIDED still missing
  collecting --> confirming: all parameters present
  collecting --> cancelled: CANCEL

  confirming --> executing: CONFIRM
  confirming --> collecting: EDIT
  confirming --> cancelled: CANCEL

  executing --> completed: EXECUTION_SUCCEEDED
  executing --> failed: EXECUTION_FAILED

  failed --> confirming: RETRY with complete parameters
  failed --> idle: RETRY without parameters
  completed --> idle: RESET
  failed --> idle: RESET
  cancelled --> idle: RESET
```

The machine is pure and framework-free. The React layer calls the workflow API;
the client machine does not perform I/O.

## 7. schedule_email placeholder flow

`schedule_email` is identified by the catalog, but Chat does not collect or
confirm it. The workflow API accepts a complete event for exercising the root
machine, where the placeholder actor fails the job.

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant Chat as Chat.tsx
  participant ActionAPI as Bun API<br/>POST /api/chat/action
  participant Engine as ActionEngine
  participant WorkflowAPI as Bun API<br/>POST /api/workflow/events
  participant Queue as InMemoryWorkflowQueue
  participant Root as root XState machine
  participant ScheduleActor as schedule_email actor

  User->>Chat: Schedule an email to john@acme.com for tomorrow at 9
  Chat->>ActionAPI: identify message
  ActionAPI->>Engine: identify
  Engine-->>ActionAPI: clear schedule_email
  ActionAPI-->>Chat: result
  Chat->>User: Scheduling is not implemented yet

  Note over Chat,WorkflowAPI: Chat does not enqueue schedule_email today
  WorkflowAPI->>Queue: optional complete schedule_email event
  Queue-->>Root: notify QUEUE_WAKE
  Root->>ScheduleActor: invoke schedule_email
  ScheduleActor-->>Root: ScheduleNotImplementedError
  Root->>Queue: mark job failed
```

There is no schedule store, worker, or real scheduled delivery yet.

## 8. Event pipeline

Identification events and execution events are separate.

```mermaid
flowchart TD
  Result["ActionIdentificationResult"] --> Publish["ActionEventPublisher.publish()"]
  Publish --> EmitCheck{"status in emitFor?<br/>default: clear"}
  EmitCheck -->|No| NoEvent["event = null"]
  EmitCheck -->|Yes| DedupeCheck{"messageId already seen?"}
  DedupeCheck -->|Yes| NoEvent
  DedupeCheck -->|No| Build["Build chat.action.identified v1"]
  Build --> Validate["Validate event schema"]
  Validate --> FanOut["FanOutEventSink.emit()"]
  FanOut --> Memory["InMemoryEventSink"]
  FanOut -.-> Handlers["handlers<br/>none currently"]
  Memory --> Response["event + eventCount in API response"]

  Confirmed["Confirmed complete action"] --> WorkflowAPI["Bun API<br/>POST /api/workflow/events"]
  WorkflowAPI --> Requested["Build workflow.action.requested v1"]
  Requested --> Queue["InMemoryWorkflowQueue"]
  Queue --> Root["Server root machine"]
```

## 9. Authentication and session flow

Authentication is client-only and stored in `localStorage`.

```mermaid
flowchart LR
  User["User"] -->|"email + password"| AuthGate["AuthGate.tsx"]
  AuthGate -->|"sign up"| Signup["Signup.tsx"]
  AuthGate -->|"sign in"| Login["Login.tsx"]
  Signup -->|"write users + session"| LocalStorage["localStorage<br/>chat_users, chat_user"]
  Login -->|"read users, write session"| LocalStorage
  LocalStorage -->|"read session"| AuthGate
  AuthGate -->|"user object"| Chat["Chat.tsx"]
  Chat -->|"sessionId"| SessionStorage["sessionStorage<br/>chat_session_id"]
  Chat -->|"identifyAction()"| API["Bun API<br/>POST /api/chat/action"]
  Chat -->|"enqueue + poll"| WorkflowAPI["/api/workflow/events"]
```

Security note: there is no server-side authentication, password hashing, or
session validation. Anyone with browser access can read or modify the stored
user data.

## 10. Runtime topology

```mermaid
flowchart TB
  subgraph BrowserProcess["Browser"]
    React["React components"]
    ClientMachine["Client XState<br/>conversation machine"]
    ClientWorkflow["lib/workflow.ts<br/>enqueue + poll"]
    LocalData["localStorage + sessionStorage"]
  end

  subgraph AstroProcess["Astro front-end process :4321"]
    AstroRoutes["Astro SSR pages + dev proxy"]
  end

  subgraph BunProcess["Bun API process :3001"]
    ApiRoutes["Bun.serve routes"]
    ActionWiring["Action engine wiring"]
    ActionPackage["action-engine package"]
    Runtime["workflow runtime singleton"]
    Queue["InMemoryWorkflowQueue"]
    RootMachine["Server root XState machine"]
    BrevoAdapter["Brevo adapter"]
    MemoryEvents["In-memory event store"]
  end

  subgraph PlannedProcess["Planned background process"]
    Scheduler["Scheduler / worker"]
  end

  subgraph ExternalServices["External services"]
    LLM["LLM API"]
    Brevo["Brevo API"]
  end

  React --> LocalData
  React --> ClientMachine
  React --> ClientWorkflow
  ClientWorkflow -->|"HTTP /api"| AstroRoutes
  AstroRoutes -->|"dev proxy"| ApiRoutes
  ApiRoutes --> ActionWiring
  ActionWiring --> ActionPackage
  ActionPackage -->|"HTTPS"| LLM
  ActionWiring --> MemoryEvents
  ApiRoutes --> Runtime
  Runtime --> Queue
  Runtime --> RootMachine
  RootMachine -->|"actor"| BrevoAdapter
  BrevoAdapter -->|"HTTPS"| Brevo
  Scheduler -.->|"planned"| Brevo
```

## 11. Data stores

| Store | Location | Persistence | Current use |
|---|---|---|---|
| `chat_users` | Browser `localStorage` | Browser-local | Sign-up accounts |
| `chat_user` | Browser `localStorage` | Browser-local | Signed-in user |
| `chat_session_id` | Browser `sessionStorage` | Tab-local | Chat session ID |
| Action events | `InMemoryEventSink` in the Bun process | Process memory | Event count and inspection |
| Pending action | Browser memory (client XState) | Lost on refresh | Implemented `send_email` conversation |
| Workflow jobs | `InMemoryWorkflowQueue` in the Bun process | Process memory | Queue, status, result, errors |
| Email / schedule records | Not implemented | None | Brevo message ID is returned but not stored |
| Sequence enrollments | Not implemented | None | Future extension; Brevo has no public sequence API |

## 12. Implementation status

| Area | Status |
|---|---|
| Chat UI and suggestions | Implemented |
| Client-only authentication | Implemented |
| Bun HTTP server and route table | Implemented |
| Vite `/api` development proxy | Implemented |
| `POST /api/chat/action` | Implemented (Bun API) |
| `send_email` catalog entry | Implemented |
| `schedule_email` catalog entry | Implemented |
| Mock classifier | Implemented |
| LLM provider | Implemented |
| Action validation | Implemented |
| Clarification for ambiguous/unknown | Implemented |
| Event publishing | Implemented |
| In-memory event storage | Implemented |
| Local option resolution | Implemented |
| Client XState `send_email` conversation | Implemented |
| Missing-parameter collection | Implemented in the client machine |
| Explicit confirmation | Implemented in the client machine |
| `POST /api/workflow/events` | Implemented (Bun API) |
| `GET /api/workflow/events/:eventId` | Implemented (Bun API) |
| `GET /health` | Implemented (Bun API) |
| In-memory workflow queue | Implemented |
| Server-side root XState machine | Implemented |
| `send_email` actor and Brevo sending | Implemented |
| `schedule_email` root state | Placeholder; always fails |
| Execution event (`workflow.action.requested`) | Implemented |
| Job status polling in Chat | Implemented |
| Direct `POST /api/email` debug route | Implemented (Bun API) |
| Persistent workflow jobs | Not implemented |
| Retry / cancellation | Not implemented |
| Scheduled email delivery | Not implemented |
| Email / schedule storage | Not implemented |
| Background scheduler | Not implemented |
| Sequence execution | Not implemented |
| Server-side authentication | Not implemented |

## 13. Endpoint inventory

All endpoints are served by the Bun API on `HOST:PORT` (default
`127.0.0.1:3001`). In development, Astro proxies `/api` to it.

| Endpoint | Status | Purpose |
|---|---|---|
| `GET /health` | Implemented | Bun API health check |
| `POST /api/chat/action` | Implemented | Identify an action from a chat message |
| `POST /api/chat/action/resolve` | Removed | Previously resolved a selected option |
| `POST /api/workflow/events` | Implemented | Validate and enqueue a confirmed action |
| `GET /api/workflow/events/:eventId` | Implemented | Read workflow job status and result |
| `POST /api/email` | Implemented | Direct debug send through Brevo, bypassing the queue |
| `POST /api/email/schedule` | Planned | Real scheduled delivery |
| `GET /api/events` | Not present | Event inspection used to be exposed |

## 14. Related documents

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [ACTION_ENGINE_DIAGRAM.md](./ACTION_ENGINE_DIAGRAM.md)
- [SETUP.md](./SETUP.md)
