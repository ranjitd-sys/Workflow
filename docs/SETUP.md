# Setup

This guide covers installation, environment configuration, running the app,
tests, and manual verification of the implemented `send_email` workflow.

For the design, see [ARCHITECTURE.md](./ARCHITECTURE.md) and
[SYSTEM_DIAGRAM.md](./SYSTEM_DIAGRAM.md).

---

## 1. Prerequisites

- Node.js 22+
- Bun 1.3+
- npm; the repository uses npm workspaces
- A Groq API key for real action identification (free tier works)
- A Brevo account, API key, and verified sender email for real delivery

---

## 2. Install

```bash
git clone <repo>
cd Workflow_execution
npm install
```

The workspace installs four packages:

- `front-end` — Astro SSR app and chat UI
- `server` — Bun HTTP API, action wiring, queue, root machine, and Brevo adapter
- `packages/action-engine` — action identification engine
- `workflow` — client conversation machine and shared workflow contracts

---

## 3. Environment

```bash
cp server/.env.example server/.env
```

Edit `server/.env`. Do not commit it; `.env` is gitignored. All LLM and Brevo
credentials belong to the server workspace, not the front-end.

The Bun server loads `server/.env` when started through `npm run dev:server` or
`npm run start:server`. The Astro dev server reads `API_PROXY_TARGET` from its
own process environment if you need a non-default API address.

### 3.1 Bun API

```env
HOST=127.0.0.1
PORT=3001
```

The front-end calls relative `/api` URLs. In development, Astro proxies `/api`
to `http://127.0.0.1:3001`. Override the proxy target when needed:

```bash
API_PROXY_TARGET=http://127.0.0.1:4000 npm run dev:front
```

### 3.2 Action identification

```env
GROQ_API_KEY=gsk_your_key_here

ACTION_LLM_API_KEY=
ACTION_LLM_BASE_URL=https://api.groq.com/openai/v1
ACTION_LLM_MODEL=openai/gpt-oss-20b
ACTION_LLM_STRICT_JSON_SCHEMA=true
ACTION_LLM_MOCK=false
```

- `ACTION_LLM_API_KEY` is optional; if empty, `GROQ_API_KEY` is used.
- `openai/gpt-oss-20b` supports strict JSON-schema output on Groq.
- Set `ACTION_LLM_STRICT_JSON_SCHEMA=false` for models that only support
  best-effort schemas.
- With no key, the app automatically uses the local mock classifier.
- Set `ACTION_LLM_MOCK=true` to force the mock even when a key exists.

Get a Groq key: https://console.groq.com/keys

### 3.3 Brevo email delivery

```env
BREVO_API_KEY=xkeysib-your-key
BREVO_SENDER_EMAIL=verified-sender@example.com
BREVO_SENDER_NAME=Your Name
```

- `BREVO_API_KEY` is server-side only.
- `BREVO_SENDER_EMAIL` must be a verified sender in Brevo.
- `BREVO_SENDER_NAME` is optional.
- Email is sent as `textContent`; no HTML template is used.
- Brevo endpoint: `POST https://api.brevo.com/v3/smtp/email`.

Immediate `send_email` is implemented through the workflow queue and server
root machine. `schedule_email` has a root-machine state, but its actor is a
placeholder and always fails. There is no schedule store, worker, or delivery
yet.

### 3.4 Environment reference

| Variable | Purpose | Default |
|---|---|---|
| `HOST` | Bun API bind address | `127.0.0.1` |
| `PORT` | Bun API port | `3001` |
| `GROQ_API_KEY` | Groq API key | — |
| `ACTION_LLM_API_KEY` | explicit action key | falls back to `GROQ_API_KEY` |
| `ACTION_LLM_BASE_URL` | OpenAI-compatible base URL | `https://api.groq.com/openai/v1` |
| `ACTION_LLM_MODEL` | action model | `openai/gpt-oss-20b` |
| `ACTION_LLM_STRICT_JSON_SCHEMA` | strict schema on/off | `true` |
| `ACTION_LLM_MOCK` | force mock classifier | `false` |
| `BREVO_API_KEY` | Brevo API key | — |
| `BREVO_SENDER_EMAIL` | verified Brevo sender | — |
| `BREVO_SENDER_NAME` | sender display name | — |
| `API_PROXY_TARGET` | Astro dev proxy target | `http://127.0.0.1:3001` |

**Restart the relevant dev process after changing environment values.** Bun reads
`server/.env` at startup; Astro reads `API_PROXY_TARGET` at startup.

---

## 4. Run

```bash
npm run dev
```

This starts both processes:

- Astro front-end: http://localhost:4321
- Bun API: http://127.0.0.1:3001

Run them separately when needed:

```bash
npm run dev:front
npm run dev:server
```

Build and run the production server version:

```bash
npm run build
npm run start:server
npm run start:front
```

The Astro dev proxy is not part of the production server. In production, use a
reverse proxy (or equivalent same-origin routing) that serves the Astro app and
forwards `/api` to the Bun API.

---

## 5. Tests and checks

```bash
npm test
npm run typecheck
npm run build
cd front-end && npx astro check
```

Current expected totals:

- 32 action-engine tests
- 10 workflow tests
- 17 server tests
- 6 front-end tests
- 65 tests total

Brevo and workflow-client tests use a mocked `fetch`; they do not send real
email. Server tests also mock `fetch` for the root-machine/Brevo path.

---

## 6. Manual test scenarios

### 6.1 Identification only

Type:

> Send an email to john@acme.com about the invoice.

Expected:

- Action: **Send Email**, status `clear`
- An action card with the `chat.action.identified` event
- The client XState workflow asks for the missing subject and body
- No email is sent until confirmation

### 6.2 Full send flow

Type:

> Send an email to recipient@example.com about the invoice.

Then answer the prompts:

- Subject: `Invoice for March`
- Body: `Please find the invoice attached.`

Expected:

- Confirmation card shows recipient, subject, and body
- `Confirm and send` calls `POST /api/workflow/events`
- The Bun server enqueues a `workflow.action.requested` event
- The server root machine invokes the `send_email` actor
- The Brevo adapter returns a `messageId`
- Chat polls the job status and shows `Email sent` with the message ID

### 6.3 Ambiguous input

Type something vague:

> Take care of this.

If the model returns `ambiguous` or `unknown`, the UI shows clarification
options. Selecting `send_email` starts the same workflow.

### 6.4 Schedule email

Type:

> Schedule an email to john@acme.com for tomorrow at 9.

Expected:

- `schedule_email` is identified
- The chat UI explains that scheduling is not implemented
- No send occurs

The workflow API still accepts a complete `schedule_email` event for exercising
the root machine. The job fails with:

> schedule_email is not implemented yet.

### 6.5 Mock classifier

With no LLM key, or with `ACTION_LLM_MOCK=true`, the mock:

- recognizes email/send wording;
- extracts a recipient email address;
- always reports `subject` and `body` as missing;
- recognizes schedule wording and extracts some time phrases.

This is intentional so the parameter-collection workflow can be tested without
an LLM.

### 6.6 API: health check

```bash
curl -s http://127.0.0.1:3001/health
```

Expected:

```json
{"ok":true}
```

### 6.7 API: identify an action

Directly against the Bun API:

```bash
curl -s -X POST http://127.0.0.1:3001/api/chat/action \
  -H 'Content-Type: application/json' \
  -d '{
    "message": "Send an email to john@acme.com about the invoice.",
    "history": [],
    "sessionId": "manual-test-1",
    "messageId": "manual-msg-1",
    "timestamp": "2026-10-23T09:00:00Z"
  }'
```

Through the Astro dev proxy, replace the origin with
`http://localhost:4321`.

### 6.8 API: enqueue a workflow action

This queues a complete, confirmed action. It does not send directly.

```bash
curl -s -X POST http://127.0.0.1:3001/api/workflow/events \
  -H 'Content-Type: application/json' \
  -d '{
    "actionId": "send_email",
    "parameters": {
      "to": "recipient@example.com",
      "subject": "API test",
      "body": "This is a test from the workflow execution app."
    },
    "sessionId": "manual-test-1"
  }'
```

Expected response (`202 Accepted`):

```json
{
  "eventId": "<uuid>",
  "actionId": "send_email",
  "status": "queued"
}
```

With Brevo configured, the actor sends the email. Without credentials, the job
fails with `BREVO_API_KEY is not configured.`

### 6.9 API: read workflow job status

```bash
curl -s http://127.0.0.1:3001/api/workflow/events/<eventId>
```

Example failure response:

```json
{
  "eventId": "<uuid>",
  "actionId": "send_email",
  "status": "failed",
  "parameters": {
    "to": "recipient@example.com",
    "subject": "API test",
    "body": "This is a test from the workflow execution app."
  },
  "createdAt": "2026-10-23T09:00:00.000Z",
  "startedAt": "2026-10-23T09:00:01.000Z",
  "finishedAt": "2026-10-23T09:00:01.100Z",
  "error": "BREVO_API_KEY is not configured."
}
```

A successful job includes `status: "succeeded"` and a `messageId`.

### 6.10 API: direct email debug endpoint

The lower-level `POST /api/email` route remains for direct debugging. It bypasses
the queue and is not used by Chat.

```bash
curl -s -X POST http://127.0.0.1:3001/api/email \
  -H 'Content-Type: application/json' \
  -d '{
    "actionId": "send_email",
    "parameters": {
      "to": "recipient@example.com",
      "subject": "API test",
      "body": "This is a test from the workflow execution app."
    }
  }'
```

Expected response:

```json
{
  "status": "sent",
  "messageId": "<brevo-message-id>"
}
```

The endpoint currently has no authentication or rate limiting.

---

## 7. Troubleshooting

### `BREVO_API_KEY is not configured.`

Set `BREVO_API_KEY` in `server/.env` and restart the Bun server. The queued job
will fail until the key is present.

### `BREVO_SENDER_EMAIL must be a valid email address.`

Set `BREVO_SENDER_EMAIL` to a valid sender address.

### Brevo returns `401` / `unauthorized`

- Check that `BREVO_API_KEY` is correct.
- Confirm the key has transactional email permission.
- Restart the Bun server after changing `server/.env`.

### Brevo rejects the sender

- Verify `BREVO_SENDER_EMAIL` in Brevo under Senders & IPs.
- Use the exact verified address.
- With a new Brevo account, sender verification may still be pending.

### `The recipient email address is invalid.`

Use a complete address such as `john@example.com`.

### `Workflow job not found. The server may have restarted.`

The queue is in-memory. Restarting the Bun server removes all jobs. Re-confirm
the action to enqueue a new job.

### `Timed out waiting for workflow action.`

The job stayed queued or running for 30 seconds. Check the Bun server log and
the Brevo adapter timeout. The in-memory actor processes jobs serially, so a long
send delays later jobs.

### Sending never starts

The workflow collects missing fields and requires explicit confirmation. Check
that the confirmation card is visible and all three fields are present. The
`POST /api/workflow/events` request must return `202` before polling can start.

### Scheduled email does nothing

`schedule_email` is intentionally not implemented in Chat or the server actor.
The root machine has a placeholder state that fails the job.

### Still seeing mock behavior

- Confirm `ACTION_LLM_MOCK=false`.
- Confirm `GROQ_API_KEY` is set in `server/.env`.
- Restart the Bun server.
- Check the `mock` flag in the `/api/chat/action` response.

### Front-end gets `404` or `502` from `/api`

- Confirm the Bun API is running on the expected port.
- Check `API_PROXY_TARGET` if you changed the API port.
- Remember that the Vite proxy applies to development only.
- In production, configure a reverse proxy for `/api`.

### Groq `429`

The provider retries `429`/`5xx` with backoff and respects `Retry-After`.
Free-tier limits still apply.

---

## 8. Security

- Keep LLM and Brevo credentials in `server/.env` only.
- `.env` is gitignored; never commit it.
- Never expose `BREVO_API_KEY` to the browser.
- `POST /api/workflow/events`, `GET /api/workflow/events/:eventId`, and
  `POST /api/email` are unauthenticated in this prototype. Do not expose them
  publicly without authentication and rate limiting.
- The workflow queue is in-memory and single-process.
- User text is treated as untrusted data by the action prompt.
- Email bodies are sent as plain text, not HTML.
