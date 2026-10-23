# Setup

This guide covers installation, environment configuration, running the three
services, tests, and manual verification.

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

- `front-end` — Astro SSR app, chat UI, and client conversation machine
- `server` — Bun public API, action identification, and workflow proxy
- `workflow` — Bun workflow service, queue, runtime, main machine, actors, Brevo
- `packages/action-engine` — action identification engine

---

## 3. Environment

The API server and workflow service use separate environment files.

```bash
cp server/.env.example server/.env
cp workflow/.env.example workflow/.env
```

Do not commit either file; `.env` is gitignored.

### 3.1 API server

```env
HOST=127.0.0.1
PORT=3001
WORKFLOW_SERVICE_URL=http://127.0.0.1:3002

GROQ_API_KEY=gsk_your_key_here
ACTION_LLM_API_KEY=
ACTION_LLM_BASE_URL=https://api.groq.com/openai/v1
ACTION_LLM_MODEL=openai/gpt-oss-20b
ACTION_LLM_STRICT_JSON_SCHEMA=true
ACTION_LLM_MOCK=false
```

- `WORKFLOW_SERVICE_URL` is the private workflow service endpoint.
- `ACTION_LLM_API_KEY` is optional; if empty, `GROQ_API_KEY` is used.
- With no key, the app uses the local mock classifier.
- Set `ACTION_LLM_MOCK=true` to force the mock even when a key exists.

Get a Groq key: https://console.groq.com/keys

### 3.2 Workflow service

```env
HOST=127.0.0.1
PORT=3002

BREVO_API_KEY=xkeysib-your-key
BREVO_SENDER_EMAIL=verified-sender@example.com
BREVO_SENDER_NAME=Your Name
```

- The workflow service binds to localhost by default.
- `BREVO_SENDER_EMAIL` must be a verified sender in Brevo.
- `BREVO_SENDER_NAME` is optional.
- Email is sent as `textContent`; no HTML template is used.
- Brevo endpoint: `POST https://api.brevo.com/v3/smtp/email`.

Immediate `send_email` is implemented through the workflow queue and main
machine. `schedule_email` has an actor placeholder and always fails.

### 3.3 Environment reference

| Variable | Purpose | Default |
|---|---|---|
| `HOST` | API or workflow bind address | `127.0.0.1` |
| `PORT` | API port / workflow port | `3001` / `3002` |
| `WORKFLOW_SERVICE_URL` | API-to-workflow URL | `http://127.0.0.1:3002` |
| `GROQ_API_KEY` | Groq API key | — |
| `ACTION_LLM_API_KEY` | explicit action key | falls back to `GROQ_API_KEY` |
| `ACTION_LLM_BASE_URL` | OpenAI-compatible base URL | `https://api.groq.com/openai/v1` |
| `ACTION_LLM_MODEL` | action model | `openai/gpt-oss-20b` |
| `ACTION_LLM_STRICT_JSON_SCHEMA` | strict schema on/off | `true` |
| `ACTION_LLM_MOCK` | force mock classifier | `false` |
| `BREVO_API_KEY` | Brevo API key | — |
| `BREVO_SENDER_EMAIL` | verified Brevo sender | — |
| `BREVO_SENDER_NAME` | sender display name | — |

**Restart the relevant process after changing its `.env`.**

---

## 4. Run

```bash
npm run dev
```

This starts three processes:

- Astro front-end: http://localhost:4321
- Bun API server: http://127.0.0.1:3001
- Bun workflow service: http://127.0.0.1:3002

Run them separately when needed:

```bash
npm run dev:front
npm run dev:server
npm run dev:workflow
```

Production-style commands:

```bash
npm run build
npm run start:server
npm run start:workflow
npm run start:front
```

The Astro dev proxy is not part of the production server. In production, use a
reverse proxy that serves the Astro app, forwards `/api` to the API server, and
keeps the workflow service on a private network.

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
- 11 workflow tests
- 11 API server tests
- 16 front-end tests
- 70 tests total

Brevo, workflow-client, and main-machine tests use mocks; they do not send real
email.

---

## 6. Manual test scenarios

### 6.1 Identification only

Type:

> Send an email to john@acme.com about the invoice.

Expected:

- Action: **Send Email**, status `clear`
- An action card with the `chat.action.identified` event
- The client conversation machine asks for the missing subject and body
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
- The API server validates and proxies to the workflow service
- The workflow service enqueues the event
- The main machine invokes the `send_email` actor
- The Brevo adapter returns a `messageId`
- Chat polls the job status and shows `Email sent`

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
the main machine. The job fails with:

> schedule_email is not implemented yet.

### 6.5 API: health checks

```bash
curl -s http://127.0.0.1:3001/health
curl -s http://127.0.0.1:3002/health
```

Expected:

```json
{"ok":true}
{"ok":true,"service":"workflow"}
```

### 6.6 API: identify an action

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

### 6.7 API: enqueue a workflow action

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

### 6.8 API: read workflow job status

```bash
curl -s http://127.0.0.1:3001/api/workflow/events/<eventId>
```

A successful job includes `status: "succeeded"` and a `messageId`.

### 6.9 API: direct email debug endpoint

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

This proxies to the workflow service and bypasses the queue.

### 6.10 Workflow service unavailable

Stop the workflow service, then try enqueueing:

```bash
curl -s -i -X POST http://127.0.0.1:3001/api/workflow/events \
  -H 'Content-Type: application/json' \
  -d '{"actionId":"send_email","parameters":{"to":"john@acme.com","subject":"Invoice","body":"Body"}}'
```

Expected:

```json
{"error":"Workflow service unavailable."}
```

with HTTP `502`.

---

## 7. Troubleshooting

### `BREVO_API_KEY is not configured.`

Set `BREVO_API_KEY` in `workflow/.env` and restart the workflow service.

### `BREVO_SENDER_EMAIL must be a valid email address.`

Set `BREVO_SENDER_EMAIL` to a valid sender address in `workflow/.env`.

### Brevo returns `401` / `unauthorized`

- Check the Brevo key in `workflow/.env`.
- Confirm the key has transactional email permission.
- Restart the workflow service after changing the key.

### Brevo rejects the sender

- Verify `BREVO_SENDER_EMAIL` in Brevo under Senders & IPs.
- Use the exact verified address.

### `The recipient email address is invalid.`

Use a complete address such as `john@example.com`.

### `Workflow job not found.`

The queue is in-memory. Restarting the workflow service removes all jobs.
Re-confirm the action to enqueue a new job.

### `Workflow service unavailable.`

- Confirm the workflow service is running on port 3002.
- Check `WORKFLOW_SERVICE_URL` in `server/.env`.
- Check the workflow service log.

### `Timed out waiting for workflow action.`

The job stayed queued or running for 30 seconds. Check both service logs. The
workflow processes one job at a time.

### Scheduled email does nothing

`schedule_email` is intentionally not implemented. The actor fails the job.

### Still seeing mock behavior

- Confirm `ACTION_LLM_MOCK=false`.
- Confirm `GROQ_API_KEY` is set in `server/.env`.
- Restart the API server.
- Check the `mock` flag in the `/api/chat/action` response.

### Front-end gets `404` or `502` from `/api`

- Confirm the API server is running on the expected port.
- Check `API_PROXY_TARGET` if you changed the API port.
- Remember that the Vite proxy applies to development only.
- In production, configure a reverse proxy for `/api`.

---

## 8. Security

- Keep LLM credentials in `server/.env` and Brevo credentials in
  `workflow/.env`.
- Never commit `.env` files.
- Never expose `BREVO_API_KEY` to the browser.
- Keep the workflow service on a private network.
- The public workflow endpoints are unauthenticated in this prototype.
- The workflow queue is in-memory and single-process.
- Email bodies are sent as plain text, not HTML.
