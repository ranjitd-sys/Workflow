# Action Identification Engine

A TypeScript monorepo that turns natural-language chat messages into validated action identifiers.

The system has two parts:

- a framework-free **action engine** that identifies an action and extracts parameters;
- a **chat application** that asks clarifying questions and fires action events.

The engine never executes actions or calls external APIs.

## Quick start

```bash
npm install
cp front-end/.env.example front-end/.env
npm run dev
```

Open http://localhost:4321.

Minimum configuration:

```env
GROQ_API_KEY=gsk_...
ACTION_LLM_BASE_URL=https://api.groq.com/openai/v1
ACTION_LLM_MODEL=openai/gpt-oss-20b
ACTION_LLM_MOCK=false
```

Without a key, the app uses a local mock classifier.

## Supported actions

The app currently identifies these action identifiers:

`send_email`, `schedule_email`.

## Flow

1. User types a message.
2. The app identifies an action identifier and parameters.
3. If the result is ambiguous or unknown, the UI asks a clarifying question.
4. For a clear action, the app fires a `chat.action.identified` event and shows the result.

## Tests

```bash
npm test
npm run typecheck
npm run build
```
