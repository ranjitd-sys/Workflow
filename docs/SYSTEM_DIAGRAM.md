# Entire System Diagram

This document describes the browser, Astro front-end, Bun API server, Bun
workflow service, action engine, events, workflow machines, in-memory queue, and
Brevo transactional email.

## Status legend

| Line style | Meaning |
|---|---|
| Solid | Implemented today |
| Dashed | Planned or not implemented |

Immediate `send_email` delivery is implemented through the public API server,
the standalone workflow service, an in-memory FIFO queue, the main workflow
machine, and a Brevo actor. The chat client keeps the clarification and
confirmation conversation, then enqueues a confirmed action. Scheduling has a
placeholder actor only.

The API server and workflow service are separate Bun processes. The API server
serves public endpoints and proxies workflow requests to the workflow service.
The workflow service owns execution state and is intended for a private network.

## 1. System context

```mermaid
flowchart LR
  User["User"] -->|"sign up / sign in"| App["Astro front-end<br/>:4321"]
  App -->|"chat message<br/>/api proxy"| API["Bun API server<br/>:3001"]
  API -->|"identify action"| Engine["Action Engine package"]
  Engine -->|"structured prompt"| LLM["LLM provider"]
  Engine -->|"clear identification"| Events["Event layer"]
  Events -->|"in-memory"| EventStore["Event store"]

  App --> ChatMachine["Chat + client conversation machine"]
  ChatMachine -->|"confirmed action<br/>POST /api/workflow/events"| API
  API -->|"internal HTTP<br/>WORKFLOW_SERVICE_URL"| Workflow["Bun workflow service<br/>:3002"]
  Workflow --> Queue["In-memory FIFO queue"]
  Queue --> MainMachine["Main workflow machine"]
  MainMachine -->|"send_email"| SendActor["Send email actor"]
  SendActor -->|"HTTPS"| Brevo["Brevo API"]
  MainMachine -->|"schedule_email"| ScheduleActor["Schedule actor<br/>placeholder"]
  Workflow -->|"job status"| API
  ChatMachine -->|"poll job status"| API

  DirectAPI["API /api/email<br/>debug route"] -->|"proxy"| Workflow
  Scheduler["Scheduler / worker<br/>planned"] -.-> SendActor
  EmailStore["Email and schedule store<br/>planned"] -.-> Scheduler
```

### Event-to-workflow mapping

| Event | Emitted when | Execution |
|---|---|---|
| `chat.action.identified` | An action is identified as `clear` | None; identification only |
| `workflow.action.requested` | User confirms a complete action | Queued in the workflow service |

The raw identification event is not an execution command. Execution requires a
confirmed, complete action.

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

  subgraph Astro["Astro front-end<br/>Node standalone :4321"]
    AstroPage["Astro pages"]
    Proxy["Vite dev proxy<br/>/api -> :3001"]
  end

  subgraph ApiServer["Bun API server :3001"]
    ActionAPI["POST /api/chat/action"]
    WorkflowAPI["POST /api/workflow/events"]
    StatusAPI["GET /api/workflow/events/:eventId"]
    DirectEmailAPI["POST /api/email"]
    HealthAPI["GET /health"]
    Wiring["server/src/action.ts"]
    Publisher["ActionEventPublisher"]
    FanOut["FanOutEventSink"]
    EventStore["InMemoryEventSink"]
    Catalog["server/src/actions/definitions.ts"]
    WorkflowClient["server/src/workflow-client.ts"]
  end

  subgraph WorkflowService["Bun workflow service :3002"]
    InternalEnqueue["POST /internal/workflow/events"]
    InternalStatus["GET /internal/workflow/events/:eventId"]
    InternalEmail["POST /internal/email"]
    WorkflowHealth["GET /health"]
    Runtime["runtime singleton"]
    QueueInstance["InMemoryWorkflowQueue"]
    MainMachine["main workflow machine"]
    ActorRegistry["actor registry"]
    SendActor["send_email actor"]
    ScheduleActor["schedule_email actor"]
    BrevoAdapter["Brevo adapter"]
  end

  subgraph WorkflowPackage["@workflow-execution/workflow"]
    Contracts["shared event/job contracts"]
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
  ClientWorkflow -->|"POST /api/workflow/events"| Proxy
  ClientWorkflow -->|"poll status"| Proxy
  Proxy --> ActionAPI
  Proxy --> WorkflowAPI
  Proxy --> StatusAPI
  Proxy --> DirectEmailAPI

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

  WorkflowAPI --> WorkflowClient
  StatusAPI --> WorkflowClient
  DirectEmailAPI --> WorkflowClient
  WorkflowClient -->|"internal HTTP"| InternalEnqueue
  WorkflowClient -->|"internal HTTP"| InternalStatus
  WorkflowClient -->|"internal HTTP"| InternalEmail

  InternalEnqueue --> Runtime
  InternalStatus --> Runtime
  Runtime --> QueueInstance
  Runtime --> MainMachine
  QueueInstance -->|"notify"| MainMachine
  MainMachine -->|"dequeue"| QueueInstance
  MainMachine -->|"dispatch"| ActorRegistry
  ActorRegistry --> SendActor
  ActorRegistry --> ScheduleActor
  SendActor --> BrevoAdapter
  BrevoAdapter -->|"HTTPS"| Brevo
  InternalEmail --> BrevoAdapter
```

## 3. Identification and clarification flow

Clear `send_email` results continue into the client conversation machine.

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant Chat as Chat.tsx
  participant Client as lib/action.ts
  participant API as Bun API server
  participant Wiring as server/src/action.ts
  participant Engine as ActionEngine
  participant LLM as LLM or mock
  participant Store as InMemoryEventSink

  User->>Chat: Type message
  Chat->>Client: identifyAction(message, history, sessionId)
  Client->>API: POST /api/chat/action
  API->>Wiring: createActionPublisher(message)
  Wiring->>Engine: identify(input)
  Engine->>LLM: structured generation request
  LLM-->>Engine: JSON result
  Engine->>Engine: validate result
  Engine-->>Wiring: ActionIdentificationResult
  Wiring->>Store: store chat.action.identified for clear results
  API-->>Client: result, event, mock, eventCount, supportedActions
  Client-->>Chat: ActionResponse

  alt status is clear
    Chat->>Chat: render ActionCard or start conversation machine
  else status is ambiguous
    Chat->>Chat: render ClarificationCard
  else status is unknown
    Chat->>Chat: ask what the user wants to do
  end
```

## 4. send_email flow

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant Chat as Chat.tsx
  participant Machine as client conversation machine
  participant API as Bun API server
  participant WorkflowAPI as workflow client
  participant Service as Bun workflow service
  participant Queue as InMemoryWorkflowQueue
  participant Main as main workflow machine
  participant SendActor as send_email actor
  participant Brevo as Brevo API

  User->>Chat: Send an email to john@acme.com
  Chat->>API: identify message
  API-->>Chat: clear send_email + missing subject, body
  Chat->>Machine: IDENTIFIED

  Machine->>Machine: collecting
  Chat->>User: Ask for missing fields
  User->>Chat: subject + body
  Chat->>Machine: PARAMETER_PROVIDED

  Machine->>Machine: confirming
  Chat->>User: Confirm sending?
  User->>Chat: Confirm and send
  Chat->>Machine: CONFIRM

  Chat->>API: POST /api/workflow/events
  API->>WorkflowAPI: enqueueWorkflowAction()
  WorkflowAPI->>Service: POST /internal/workflow/events
  Service->>Queue: enqueue(workflow.action.requested)
  Service-->>WorkflowAPI: 202 { eventId, status: queued }
  WorkflowAPI-->>API: enqueued job
  API-->>Chat: 202 { eventId, status: queued }

  Queue-->>Main: notify QUEUE_WAKE
  Main->>Queue: dequeue next event
  Main->>Queue: mark job running
  Main->>SendActor: invoke send_email
  SendActor->>Brevo: POST /v3/smtp/email
  Brevo-->>SendActor: 201 { messageId }
  SendActor-->>Main: { messageId }
  Main->>Queue: mark job succeeded

  loop poll until terminal state
    Chat->>API: GET /api/workflow/events/:eventId
    API->>WorkflowAPI: getWorkflowJob()
    WorkflowAPI->>Service: GET /internal/workflow/events/:eventId
    Service->>Queue: read job
    Service-->>API: status + messageId
    API-->>Chat: status + messageId
  end

  Chat->>Machine: EXECUTION_SUCCEEDED
  Chat->>User: Email sent + message ID
```

If the actor fails, the main machine records `status: failed` and the error.
Chat sends `EXECUTION_FAILED` to the client machine.

## 5. Main workflow machine

The main machine lives in `workflow/src/server/main-machine.ts` inside the
workflow service.

```mermaid
stateDiagram-v2
  [*] --> idle
  idle --> processing: QUEUE_WAKE / has queued job
  processing --> completed: actor done
  processing --> failed: actor error
  completed --> idle: always / clear current job
  failed --> idle: always / clear current job
```

The queue listener wakes the machine whenever a job is enqueued. The machine
processes one job at a time, looks up the actor by `event.actionId`, and raises
another wake-up after completion.

## 6. Client conversation machine

The client machine lives in
`front-end/src/lib/chat/send-email-conversation-machine.ts`.

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

The machine is pure and framework-free. `Chat.tsx` performs identification,
enqueueing, and polling.

## 7. Runtime topology

```mermaid
flowchart TB
  subgraph BrowserProcess["Browser"]
    React["React components"]
    ClientMachine["Client conversation machine"]
    ClientWorkflow["lib/workflow.ts<br/>enqueue + poll"]
    LocalData["localStorage + sessionStorage"]
  end

  subgraph AstroProcess["Astro front-end process :4321"]
    AstroRoutes["Astro SSR pages + dev proxy"]
  end

  subgraph ApiProcess["Bun API server process :3001"]
    ApiRoutes["Bun.serve public routes"]
    ActionWiring["Action engine wiring"]
    ActionPackage["action-engine package"]
    WorkflowClient["workflow HTTP client"]
    MemoryEvents["In-memory event store"]
  end

  subgraph WorkflowProcess["Bun workflow service process :3002"]
    WorkflowRoutes["Bun.serve internal routes"]
    Runtime["workflow runtime singleton"]
    Queue["InMemoryWorkflowQueue"]
    MainMachine["Main workflow machine"]
    Actors["Actor registry"]
    BrevoAdapter["Brevo adapter"]
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
  ApiRoutes --> WorkflowClient
  WorkflowClient -->|"HTTP internal"| WorkflowRoutes
  WorkflowRoutes --> Runtime
  Runtime --> Queue
  Runtime --> MainMachine
  MainMachine --> Actors
  Actors --> BrevoAdapter
  BrevoAdapter -->|"HTTPS"| Brevo
  Scheduler -.->|"planned"| Brevo
```

## 8. Data stores

| Store | Location | Persistence | Current use |
|---|---|---|---|
| `chat_users` | Browser `localStorage` | Browser-local | Sign-up accounts |
| `chat_user` | Browser `localStorage` | Browser-local | Signed-in user |
| `chat_session_id` | Browser `sessionStorage` | Tab-local | Chat session ID |
| Action events | `InMemoryEventSink` in the API server | Process memory | Event count and inspection |
| Pending action | Browser memory (client XState) | Lost on refresh | `send_email` conversation |
| Workflow jobs | `InMemoryWorkflowQueue` in the workflow service | Process memory | Queue, status, result, errors |
| Email / schedule records | Not implemented | None | Brevo message ID is returned but not stored |
| Sequence enrollments | Not implemented | None | Future extension |

## 9. Implementation status

| Area | Status |
|---|---|
| Chat UI and suggestions | Implemented |
| Client-only authentication | Implemented |
| Client conversation machine in front-end | Implemented |
| Bun API server and public routes | Implemented |
| Bun workflow service and internal routes | Implemented |
| API-to-workflow HTTP proxy | Implemented |
| `POST /api/chat/action` | Implemented |
| `send_email` catalog entry | Implemented |
| `schedule_email` catalog entry | Implemented |
| Mock classifier | Implemented |
| LLM provider | Implemented |
| Action validation | Implemented |
| Clarification for ambiguous/unknown | Implemented |
| Event publishing | Implemented |
| In-memory event storage | Implemented |
| Client XState `send_email` conversation | Implemented |
| Missing-parameter collection | Implemented in the client machine |
| Explicit confirmation | Implemented in the client machine |
| `POST /api/workflow/events` | Implemented |
| `GET /api/workflow/events/:eventId` | Implemented |
| In-memory workflow queue | Implemented in the workflow service |
| Main workflow machine | Implemented |
| `send_email` actor and Brevo sending | Implemented |
| `schedule_email` actor | Placeholder; always fails |
| Execution event (`workflow.action.requested`) | Implemented |
| Job status polling in Chat | Implemented |
| Direct `/api/email` debug route | Implemented; proxied |
| Persistent workflow jobs | Not implemented |
| Retry / cancellation | Not implemented |
| Scheduled email delivery | Not implemented |
| Email / schedule storage | Not implemented |
| Background scheduler | Not implemented |
| Server-side authentication | Not implemented |

## 10. Endpoint inventory

Public API server, default `127.0.0.1:3001`:

| Endpoint | Status | Purpose |
|---|---|---|
| `GET /health` | Implemented | API server health |
| `POST /api/chat/action` | Implemented | Identify an action |
| `POST /api/workflow/events` | Implemented | Validate and proxy enqueue |
| `GET /api/workflow/events/:eventId` | Implemented | Proxy job status |
| `POST /api/email` | Implemented | Proxy direct debug send |

Internal workflow service, default `127.0.0.1:3002`:

| Endpoint | Status | Purpose |
|---|---|---|
| `GET /health` | Implemented | Workflow service health |
| `POST /internal/workflow/events` | Implemented | Enqueue a confirmed action |
| `GET /internal/workflow/events/:eventId` | Implemented | Read job status |
| `POST /internal/email` | Implemented | Direct debug send |

## 11. Related documents

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [ACTION_ENGINE_DIAGRAM.md](./ACTION_ENGINE_DIAGRAM.md)
- [SETUP.md](./SETUP.md)
