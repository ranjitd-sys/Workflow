# Action Engine Diagram

For authentication, planned email delivery, scheduling, and the full end-to-end
system, see [SYSTEM_DIAGRAM.md](./SYSTEM_DIAGRAM.md).

This document shows how the current action identification system fits together.
It covers only the implemented flow: chat message -> action identification ->
event storage. Email delivery and the confirmation loop are not implemented yet.

## 1. Component diagram

```mermaid
flowchart LR
  subgraph Browser["Browser"]
    Chat["Chat.tsx<br/>send(), chooseOption()"]
    Client["lib/action.ts<br/>identifyAction()"]
  end

  subgraph FrontendServer["Astro server"]
    API["POST /api/chat/action"]
    Wiring["server/action.ts<br/>createActionPublisher()"]
    Definitions["server/actions/definitions.ts<br/>send_email, schedule_email"]
    Mock["server/mock-action.ts<br/>local regex classifier"]
    Env["server/env.ts<br/>environment lookup"]
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
  participant API as POST /api/chat/action
  participant Wiring as server/action.ts
  participant Publisher as ActionEventPublisher
  participant Engine as ActionEngine
  participant Registry as ActionRegistry
  participant Provider as LLM or mock
  participant Validate as validate.ts
  participant FanOut as FanOutEventSink
  participant Store as InMemoryEventSink

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

  alt status is clear
    Chat->>Chat: render ActionCard
  else status is ambiguous or unknown
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

## 4. UI decision flow

```mermaid
flowchart TD
  Send["User sends message"] --> Identify["identifyAction()"]
  Identify --> Status{"result.action.status"}

  Status -->|clear| ActionCard["Render ActionCard"]
  Status -->|ambiguous| AskOptions["Build clarification options<br/>from alternatives"]
  Status -->|unknown| AskAction["Ask what the user wants to do"]

  AskOptions --> Choose["User chooses an option"]
  AskAction --> Choose
  Choose --> LocalResolve["chooseOption()<br/>set status clear locally"]
  LocalResolve --> ActionCard
```

## 5. Current action taxonomy

The app-level catalog lives in
`front-end/src/server/actions/definitions.ts`.

| Action | Purpose | Required parameters |
|---|---|---|
| `send_email` | Send one email immediately | `to`, `subject`, `body` |
| `schedule_email` | Send one email at a future time | `to`, `subject`, `body`, `send_at` |

The catalog is injected into `ActionEngine` by `front-end/src/server/action.ts`.
The action engine has no knowledge of Brevo or email delivery.

## 6. Current boundaries

- The API route only identifies an action. It does not send email.
- Only `clear` results publish `chat.action.identified` events.
- Ambiguous and unknown results return `event: null` and stay in the UI.
- Events are stored in memory and are lost when the server restarts.
- `FanOutEventSink` has no handlers configured, so no follow-up work runs.
- The deleted `/api/chat/action/resolve` endpoint is no longer used.
  `Chat.tsx` resolves a selected clarification option locally.
- Email execution and the confirmation loop still need to be added.
