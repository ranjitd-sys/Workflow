# Architecture

See [SYSTEM_DIAGRAM.md](./SYSTEM_DIAGRAM.md) for the complete system diagram,
and [ACTION_ENGINE_DIAGRAM.md](./ACTION_ENGINE_DIAGRAM.md) for the detailed
component, request, event, and UI diagrams.

## Purpose and boundaries

The system has two responsibilities:

1. **Identify** a user message as a validated action identifier and parameters.
2. **Publish** an action event when the result is clear.

The action engine does not execute actions or call external APIs.

## High-level flow

```text
User message
  -> Chat UI
  -> POST /api/chat/action
  -> ActionEngine
  -> LLM
  -> ActionEventPublisher
  -> FanOutEventSink
     -> InMemoryEventSink
  -> Action card in UI
```

## Repository layout

```text
.
├── front-end/
│   ├── src/components/chat/Chat.tsx
│   ├── src/lib/action.ts
│   ├── src/pages/api/chat/action.ts
│   └── src/server/
│       ├── action.ts
│       ├── mock-action.ts
│       └── actions/definitions.ts
└── packages/action-engine/
```

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

Only clear actions publish `chat.action.identified` events. Ambiguous and unknown results stay in the UI for clarification.
