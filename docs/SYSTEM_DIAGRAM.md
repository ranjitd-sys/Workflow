# Entire System Diagram

This document describes the complete system: browser, authentication, chat UI,
Astro server, action engine, events, LLM provider, and the planned email
delivery layer.

## Status legend

| Line style | Meaning |
|---|---|
| Solid | Implemented today |
| Dashed | Planned or not implemented |

Email delivery, scheduling, Brevo integration, parameter collection, and
confirmation are **not implemented** yet. They are shown as planned.

## 1. System context

```mermaid
flowchart LR
  User["User"] -->|"sign up / sign in"| App["Astro web app"]
  App -->|"chat message"| ActionAPI["Action identification API"]
  ActionAPI --> Engine["Action Engine package"]
  Engine -->|"structured prompt"| LLM["LLM provider"]
  Engine -->|"clear event"| Events["Event layer"]
  Events -->|"in-memory"| EventStore["Event store"]

  Events -.->|"planned event<br/>email.send.requested"| BrevoWorkflow["Brevo workflow<br/>send_email"]

  App -.->|"planned"| EmailAPI["Email execution API"]
  EmailAPI -.-> EmailService["Email service<br/>custom Brevo adapter"]
  EmailService -.->|"planned"| Brevo["Brevo API"]
  BrevoWorkflow -.-> Brevo
  Scheduler["Scheduler / worker<br/>planned"] -.-> EmailService
  EmailStore["Email and schedule store<br/>planned"] -.-> Scheduler
  EmailService -.-> EmailStore
```

### Event-to-Brevo workflow mapping (for now)

| Event | Emitted when | Brevo workflow |
|---|---|---|
| `email.send.requested` | User confirms a `send_email` action | `send_email` |

The current implementation emits `chat.action.identified`. The
`email.send.requested` event is the planned execution event, emitted only after
confirmation. `email.schedule.requested` can be added later for
`schedule_email`.

## 2. Component architecture

```mermaid
flowchart TB
  subgraph Browser["Browser"]
    Page["pages/index.astro"]
    AuthGate["AuthGate.tsx"]
    AuthUI["Login.tsx / Signup.tsx"]
    LocalAuth["lib/auth.ts<br/>localStorage users + session"]
    Chat["Chat.tsx<br/>transcript + suggestions"]
    ClientAction["lib/action.ts<br/>identifyAction()"]
    Session["sessionStorage<br/>chat_session_id"]
    ActionCard["ActionCard / ClarificationCard"]
  end

  subgraph Astro["Astro server<br/>Node standalone"]
    API["POST /api/chat/action"]
    Wiring["server/action.ts<br/>createActionPublisher()"]
    Env["server/env.ts"]
    Catalog["server/actions/definitions.ts<br/>send_email, schedule_email"]
    Mock["server/mock-action.ts"]
    Publisher["ActionEventPublisher"]
    FanOut["FanOutEventSink"]
    Store["InMemoryEventSink"]
    EmailAPI["Email execution endpoint(s)<br/>PLANNED"]
    EmailService["Email service<br/>Brevo adapter PLANNED"]
    Scheduler["Scheduler / cron<br/>PLANNED"]
    EmailStore["Email / schedule store<br/>PLANNED"]
  end

  subgraph Package["@workflow-execution/action-engine"]
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

  Page --> AuthGate
  AuthGate --> AuthUI
  AuthGate --> LocalAuth
  AuthGate --> Chat
  Chat --> ClientAction
  Chat --> Session
  Chat --> ActionCard
  ClientAction -->|"POST JSON"| API
  API -->|"response JSON"| ClientAction

  API --> Wiring
  Wiring --> Env
  Wiring --> Catalog
  Wiring -->|"mock mode"| Mock
  Wiring -->|"real mode"| OpenAI
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
  FanOut --> Store
  Store -->|"eventCount"| API

  Chat -.->|"confirm send"| EmailAPI
  EmailAPI -.-> EmailService
  EmailService -.-> Brevo
  EmailService -.-> EmailStore
  Scheduler -.-> EmailStore
  Scheduler -.-> EmailService
```

## 3. Current implemented flow

This is the flow that exists in the repository today.

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant Auth as AuthGate
  participant Chat as Chat.tsx
  participant Client as lib/action.ts
  participant API as POST /api/chat/action
  participant Wiring as server/action.ts
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

## 4. Planned send_email flow

`send_email` is currently identified but not executed.

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant Chat as Chat.tsx
  participant API as POST /api/chat/action
  participant Engine as ActionEngine
  participant State as Pending action state
  participant EmailAPI as Email execution API
  participant Email as Email service
  participant Brevo as Brevo API

  User->>Chat: Send an email to john@acme.com
  Chat->>API: identify message
  API->>Engine: identify
  Engine-->>API: clear send_email + missing subject, body
  API-->>Chat: result
  Chat->>State: create pending send_email

  Chat->>User: What should the subject be?
  User->>Chat: Invoice for March
  Chat->>State: merge subject

  Chat->>User: What should the email say?
  User->>Chat: Please find the invoice attached.
  Chat->>State: merge body

  State-->>Chat: all required fields present
  Chat->>User: Confirm sending to john@acme.com?
  User->>Chat: Confirm

  Chat->>EmailAPI: POST send email
  EmailAPI->>Email: send now
  Email->>Brevo: POST /v3/smtp/email
  Brevo-->>Email: messageId
  Email-->>EmailAPI: sent
  EmailAPI-->>Chat: success + messageId
  Chat->>User: Email sent
```

## 5. Planned schedule_email flow

`schedule_email` is currently identified but not executed.

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant Chat as Chat.tsx
  participant API as POST /api/chat/action
  participant Engine as ActionEngine
  participant State as Pending action state
  participant EmailAPI as Email execution API
  participant Email as Email service
  participant Store as Email / schedule store
  participant Brevo as Brevo API

  User->>Chat: Schedule an email to john@acme.com for tomorrow at 9
  Chat->>API: identify message
  API->>Engine: identify
  Engine-->>API: clear schedule_email + missing subject, body
  API-->>Chat: result
  Chat->>State: create pending schedule_email

  Chat->>User: What should the subject be?
  User->>Chat: Invoice for March
  Chat->>State: merge subject

  Chat->>User: What should the email say?
  User->>Chat: Please find the invoice attached.
  Chat->>State: merge body

  State-->>Chat: all required fields present
  Chat->>User: Confirm scheduling for tomorrow at 9?
  User->>Chat: Confirm

  Chat->>EmailAPI: POST schedule email
  EmailAPI->>Email: schedule email
  Email->>Brevo: POST /v3/smtp/email with scheduledAt
  Brevo-->>Email: scheduled messageId
  Email->>Store: record scheduled email
  Email-->>EmailAPI: scheduled
  EmailAPI-->>Chat: success + scheduled time
  Chat->>User: Email scheduled
```

## 6. Clarification and confirmation state machine

Implemented states are solid. Planned states are dashed.

```mermaid
stateDiagram-v2
  [*] --> Idle
  Idle --> Identifying: user sends message

  Identifying --> Clear: status clear
  Identifying --> Ambiguous: status ambiguous
  Identifying --> Unknown: status unknown

  Clear --> ActionCard: no missing required fields
  Clear --> Collecting: missing required fields

  Ambiguous --> Clarify: show alternatives
  Unknown --> Clarify: ask what to do

  Clarify --> Identifying: user replies
  Clarify --> Clear: user chooses an option

  Collecting --> Collecting: ask next missing field
  Collecting --> Confirming: all required fields present
  Confirming --> Collecting: edit
  Confirming --> Executing: user confirms
  Confirming --> Idle: user cancels

  Executing --> Success
  Executing --> Error
  Success --> Idle
  Error --> Idle
```

Current implementation stops at `ActionCard` or `Clarify`. `Collecting`,
`Confirming`, `Executing`, and `Success` are planned.

## 7. Event pipeline

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
```

## 8. Authentication and session flow

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
  Chat -->|"identifyAction()"| API["POST /api/chat/action"]
```

Security note: there is no server-side authentication, password hashing, or
session validation. Anyone with browser access can read or modify the stored
user data.

## 9. Runtime topology

```mermaid
flowchart TB
  subgraph BrowserProcess["Browser"]
    React["React components"]
    LocalData["localStorage + sessionStorage"]
  end

  subgraph NodeProcess["Astro Node server"]
    AstroRoutes["Astro routes and API"]
    ActionWiring["Action engine wiring"]
    ActionPackage["action-engine package"]
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
  React -->|"HTTP"| AstroRoutes
  AstroRoutes --> ActionWiring
  ActionWiring --> ActionPackage
  ActionPackage -->|"HTTPS"| LLM
  ActionWiring --> MemoryEvents
  AstroRoutes -.->|"planned"| Brevo
  Scheduler -.->|"planned"| Brevo
```

## 10. Data stores

| Store | Location | Persistence | Current use |
|---|---|---|---|
| `chat_users` | Browser `localStorage` | Browser-local | Sign-up accounts |
| `chat_user` | Browser `localStorage` | Browser-local | Signed-in user |
| `chat_session_id` | Browser `sessionStorage` | Tab-local | Chat session ID |
| Action events | `InMemoryEventSink` | Process memory | Event count and inspection |
| Pending action | Browser memory | Lost on refresh | Planned state machine |
| Email / schedule records | Not implemented | None | Planned |
| Sequence enrollments | Not implemented | None | Future extension |

## 11. Implementation status

| Area | Status |
|---|---|
| Chat UI and suggestions | Implemented |
| Client-only authentication | Implemented |
| `POST /api/chat/action` | Implemented |
| `send_email` catalog entry | Implemented |
| `schedule_email` catalog entry | Implemented |
| Mock classifier | Implemented |
| LLM provider | Implemented |
| Action validation | Implemented |
| Clarification for ambiguous/unknown | Implemented |
| Event publishing | Implemented |
| In-memory event storage | Implemented |
| Local option resolution | Implemented |
| Missing-parameter collection | Not implemented |
| Explicit confirmation | Not implemented |
| Brevo email sending | Not implemented |
| Scheduled email delivery | Not implemented |
| Email / schedule storage | Not implemented |
| Background scheduler | Not implemented |
| Sequence execution | Not implemented |
| Server-side authentication | Not implemented |

## 12. Endpoint inventory

| Endpoint | Status | Purpose |
|---|---|---|
| `POST /api/chat/action` | Implemented | Identify an action from a chat message |
| `POST /api/chat/action/resolve` | Removed | Previously resolved a selected option |
| `POST /api/email/send` | Planned | Execute `send_email` |
| `POST /api/email/schedule` | Planned | Execute `schedule_email` |
| `GET /api/events` | Not present | Event inspection used to be exposed |

## 13. Related documents

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [ACTION_ENGINE_DIAGRAM.md](./ACTION_ENGINE_DIAGRAM.md)
- [SETUP.md](./SETUP.md)
