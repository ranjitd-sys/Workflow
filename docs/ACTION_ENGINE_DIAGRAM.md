# Action Engine Diagram

For authentication, email delivery, scheduling, and the full end-to-end system,
see [SYSTEM_DIAGRAM.md](./SYSTEM_DIAGRAM.md).

This document focuses on action identification: chat message -> action
identification -> event storage. After identification, Chat collects and
confirms `send_email`, then hands a complete action to the Bun HTTP API workflow
queue. See the system diagram for the queue and root-machine execution flow.

## 1. Component diagram

```mermaid
flowchart LR
  subgraph Browser["Browser"]
    Chat["Chat.tsx<br/>send(), chooseOption()"]
    Client["lib/action.ts<br/>identifyAction()"]
    ClientMachine["client XState<br/>sendEmail machine"]
    WorkflowClient["lib/workflow.ts<br/>enqueue + poll"]
  end

  subgraph BunServer["Bun HTTP API :3001"]
    API["POST /api/chat/action"]
    WorkflowAPI["POST /api/workflow/events"]
    Wiring["server/src/action.ts<br/>createActionPublisher()"]
    Definitions["server/src/actions/definitions.ts<br/>send_email, schedule_email"]
    Mock["server/src/actions/mock-action.ts<br/>local regex classifier"]
    Env["server/src/env.ts<br/>environment lookup"]
    Runtime["server/src/workflow/runtime.ts<br/>queue + root machine"]
  end

  subgraph Engine["@workflow-execution/action-engine"]
    ActionEngine["ActionEngine.identify()"]
    Registry["ActionRegistry"]
    Prompt["prompt.ts<br/>system prompt + JSON schema"]
    Provider["StructuredLlmProvider"]
    LLM["OpenAI-compatible LLM"]
    Validate["validate.ts"]
  end

  subgraph EventLayer["Event layer"]
    Publisher["ActionEventPublisher"]
    FanOut["FanOutEventSink"]
    Store["InMemoryEventSink"]
  end

  Chat --> Client
  Chat --> ClientMachine
  Chat --> WorkflowClient
  Client -->|"POST message, history, sessionId"| API
  API --> Wiring
  Definitions --> Wiring
  Mock --> Wiring
  Env --> Wiring

  Wiring --> ActionEngine
  Wiring --> Publisher
  Publisher --> ActionEngine

  ActionEngine --> Registry
  ActionEngine --> Prompt
  ActionEngine --> Provider
  Provider --> LLM
  ActionEngine --> Validate

  Publisher --> FanOut
  FanOut --> Store

  WorkflowClient -->|"confirmed complete action"| WorkflowAPI
  WorkflowAPI --> Runtime

  API -->|"result, event, mock, eventCount"| Client
  Client --> Chat
```

## 2. Request sequence

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant Chat as Chat.tsx
  participant Client as lib/action.ts
  participant API as Bun API<br/>POST /api/chat/action
  participant Wiring as server/src/action.ts
  participant Publisher as ActionEventPublisher
  participant Engine as ActionEngine
  participant Registry as ActionRegistry
  participant Provider as LLM or mock
  participant Validate as validate.ts
  participant FanOut as FanOutEventSink
  participant Store as InMemoryEventSink
  participant Machine as client sendEmail machine

  User->>Chat: Type a message
  Chat->>Client: identifyAction(message, history, sessionId)
  Client->>API: POST JSON
  API->>Wiring: createActionPublisher(message)
  Wiring->>Wiring: choose provider, engine, publisher
  Wiring-->>API: { publisher, mock }
  API->>Publisher: handle(input)
  Publisher->>Engine: identify(input)
  Engine->>Registry: list action catalog
  Engine->>Provider: system prompt + user prompt + JSON schema
  Provider-->>Engine: structured JSON
  Engine->>Validate: validate result
  Validate-->>Engine: validated result or error
  Engine-->>Publisher: ActionIdentificationResult

  alt status is clear
    Publisher->>Publisher: build event
    Publisher->>Publisher: validate event schema
    Publisher->>FanOut: emit(event)
    FanOut->>Store: emit(event)
    Store-->>FanOut: stored
    FanOut-->>Publisher: done
    Publisher-->>API: { result, event }
  else status is ambiguous or unknown
    Publisher-->>API: { result, event: null }
  end

  API-->>Client: JSON response
  Client-->>Chat: ActionResponse

  alt clear send_email
    Chat->>Machine: IDENTIFIED
    Machine-->>Chat: collect missing fields, then confirm
  else clear schedule_email
    Chat->>Chat: explain scheduling is not implemented
  else ambiguous or unknown
    Chat->>Chat: render ClarificationCard
  end
```

## 3. Event pipeline

```mermaid
flowchart TD
  Result["ActionIdentificationResult"] --> Publish["ActionEventPublisher.publish()"]
  Publish --> EmitCheck{"status in emitFor?<br/>default: clear"}
  EmitCheck -->|No| NoEvent["event = null"]
  EmitCheck -->|Yes| DedupeCheck{"messageId already seen?"}
  DedupeCheck -->|Yes| NoEvent
  DedupeCheck -->|No| Build["Build event<br/>chat.action.identified v1"]
  Build --> EventValidate["Validate event schema"]
  EventValidate --> FanOut["FanOutEventSink.emit()"]
  FanOut --> Memory["InMemoryEventSink"]
  FanOut -.-> Handlers["handlers (none currently)"]
  Memory --> Response["response.event + eventCount"]
```

The identification event is not an execution command. The execution event is
created separately after confirmation.

## 4. UI decision flow

```mermaid
flowchart TD
  Send["User sends message"] --> Identify["identifyAction()"]
  Identify --> Status{"result.action.status"}

  Status -->|clear send_email| Machine["Client sendEmail machine<br/>collect + confirm"]
  Status -->|clear schedule_email| Unsupported["Explain scheduling<br/>is not implemented"]
  Status -->|clear other| ActionCard["Render ActionCard"]
  Status -->|ambiguous| AskOptions["Build clarification options<br/>from alternatives"]
  Status -->|unknown| AskAction["Ask what the user wants to do"]

  AskOptions --> Choose["User chooses an option"]
  AskAction --> Choose
  Choose --> LocalResolve["chooseOption()<br/>set status clear locally"]
  LocalResolve --> Machine
  Machine --> Confirm["User confirms"]
  Confirm --> Enqueue["Bun API<br/>POST /api/workflow/events"]
  Enqueue --> Queue["In-memory workflow queue"]
```

## 5. Current action taxonomy

The app-level catalog lives in `server/src/actions/definitions.ts`.

| Action | Purpose | Required parameters |
|---|---|---|
| `send_email` | Send one email immediately | `to`, `subject`, `body` |
| `schedule_email` | Send one email at a future time | `to`, `subject`, `body`, `send_at` |

The catalog is injected into `ActionEngine` by `server/src/action.ts`. The
action engine has no knowledge of Brevo or email delivery.

## 6. Execution handoff

```mermaid
flowchart LR
  Clear["Clear send_email"] --> Collect["Client machine<br/>collect missing fields"]
  Collect --> Confirm["Explicit confirmation"]
  Confirm --> Enqueue["Bun API<br/>POST /api/workflow/events"]
  Enqueue --> Validate["Validate actionId +<br/>required parameters"]
  Validate --> Queue["InMemoryWorkflowQueue"]
  Queue --> Root["Server root machine"]
  Root -->|"send_email"| Actor["Brevo actor"]
  Root -->|"schedule_email"| Placeholder["Placeholder actor<br/>always fails"]
  Actor --> Brevo["Brevo API"]
```

Only complete, confirmed actions reach the queue. The raw identification event
does not trigger execution.

## 7. Current boundaries

- The action-identification API only identifies an action. It does not send email.
- Only `clear` results publish `chat.action.identified` events.
- Ambiguous and unknown results return `event: null` and stay in the UI.
- Identification events are stored in memory and are lost when the server restarts.
- `FanOutEventSink` has no execution handlers configured.
- The deleted `/api/chat/action/resolve` endpoint is no longer used.
  `Chat.tsx` resolves a selected clarification option locally.
- Confirmed `send_email` actions are queued and executed by the Bun server root
  machine; `schedule_email` is a placeholder.
- Workflow jobs are in-memory and single-process.
- In development, Astro proxies `/api` to the Bun API; production needs a
  reverse proxy.
