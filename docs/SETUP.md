# Setup

This guide covers installation, environment configuration, running the app, and
testing the intent + email flows.

For the design, see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## 1. Prerequisites

- Node.js 22+
- npm (the repo uses npm workspaces)
- A Groq API key (free tier works)
- Optional: a Gmail account with 2-Step Verification and an App Password for
  real email delivery

---

## 2. Install

```bash
git clone <repo>
cd Workflow_execution
npm install
```

---

## 3. Environment

```bash
cp front-end/.env.example front-end/.env
```

Then edit `front-end/.env`. Do not commit it — it is gitignored.

### 3.1 Intent engine (required for real classification)

```env
GROQ_API_KEY=gsk_your_key_here

INTENT_LLM_API_KEY=
INTENT_LLM_BASE_URL=https://api.groq.com/openai/v1
INTENT_LLM_MODEL=openai/gpt-oss-20b
INTENT_LLM_STRICT_JSON_SCHEMA=true
INTENT_LLM_MOCK=false
```

- `INTENT_LLM_API_KEY` is optional; if empty, `GROQ_API_KEY` is used.
- `openai/gpt-oss-20b` supports strict JSON-schema output on Groq.
- For models that only support best-effort schemas, set
  `INTENT_LLM_STRICT_JSON_SCHEMA=false`.
- With no key at all, the app automatically uses the local mock classifier.
- Set `INTENT_LLM_MOCK=true` to force the mock even when a key exists.

Get a Groq key: https://console.groq.com/keys

### 3.2 Email sender

The app supports two senders.

#### Mock (no delivery)

```env
EMAIL_PROVIDER=mock
```

The worker records emails in memory and the UI shows `Email sent to …`, but no
message leaves the server.

#### Gmail SMTP

```env
EMAIL_PROVIDER=smtp
EMAIL_FROM=your.address@gmail.com

SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your.address@gmail.com
SMTP_PASS=your_google_app_password
```

Notes:

- `EMAIL_FROM` should match `SMTP_USER` for Gmail.
- Port `465` uses `SMTP_SECURE=true`.
- Port `587` uses `SMTP_SECURE=false` (STARTTLS).
- `SMTP_PASS` must be a Google **App Password**, not your normal password.
- `SMTP_URL` can be used instead of host/port/user/pass:
  `smtps://user:app-password@smtp.gmail.com:465`

#### Creating a Google App Password

1. Open Google Account → Security.
2. Enable **2-Step Verification**.
3. Open **App passwords**.
4. Create one for “Mail”.
5. Copy the 16-character value into `SMTP_PASS`.

Google Workspace administrators can disable App Passwords.

### 3.3 Environment reference

| Variable | Purpose | Default |
|---|---|---|
| `GROQ_API_KEY` | Groq API key | — |
| `INTENT_LLM_API_KEY` | explicit intent key | falls back to `GROQ_API_KEY` |
| `INTENT_LLM_BASE_URL` | OpenAI-compatible base URL | `https://api.groq.com/openai/v1` |
| `INTENT_LLM_MODEL` | intent model | `openai/gpt-oss-20b` |
| `INTENT_LLM_STRICT_JSON_SCHEMA` | strict schema on/off | `true` |
| `INTENT_LLM_MOCK` | force mock classifier | `false` |
| `EMAIL_PROVIDER` | `mock` or `smtp` | `mock` |
| `EMAIL_FROM` | sender address | falls back to `SMTP_USER` |
| `SMTP_HOST` | SMTP host | `smtp.gmail.com` |
| `SMTP_PORT` | SMTP port | `465` |
| `SMTP_SECURE` | TLS mode | `true` |
| `SMTP_USER` | SMTP username | — |
| `SMTP_PASS` | SMTP password / App Password | — |
| `SMTP_URL` | full SMTP URL (optional) | — |

**Restart the dev server after changing `.env`.** Vite reads it at startup.

---

## 4. Run

```bash
npm run dev
```

Open http://localhost:4321.

Build and run the server version:

```bash
npm run build
node front-end/dist/server/entry.mjs
```

---

## 5. Tests

```bash
npm test          # engine + front-end tests
npm run typecheck # engine package
npm run build     # Astro server build
```

Expected:

- 69 engine tests
- 11 front-end tests
- 80 total

SMTP tests use an injected transport and do not send real email.

---

## 6. Manual test scenarios

### 6.1 Intent only

Type:

> What time is the meeting tomorrow?

Expected: a **Question** intent card with `clear`, an event id, and no email
side effect.

### 6.2 Ambiguous intent

Type something vague, for example:

> Take care of this.

If the model returns `ambiguous` or `unknown`, the UI asks a clarification
question with intent options. Selecting one fires the event.

### 6.3 Send email (happy path)

Type:

> Send an email to your.address@gmail.com saying This is a test from the intent engine.

Expected:

- Intent: **Send Email**, `clear`
- `Email sent to your.address@gmail.com`
- Email arrives (check Spam too)

API equivalent:

```bash
curl -s -X POST http://localhost:4321/api/chat/intent \
  -H 'Content-Type: application/json' \
  -d '{
    "message": "Send an email to your.address@gmail.com saying This is an API test.",
    "history": [],
    "sessionId": "smtp-test-1",
    "messageId": "smtp-msg-1",
    "timestamp": "2026-07-15T09:00:00Z"
  }'
```

Inspect the outbox:

```bash
curl -s "http://localhost:4321/api/emails?sessionId=smtp-test-1"
```

### 6.4 Missing or invalid recipient

Type:

> Send an email to John saying I'll be late.

Expected: `needs_info` — recipient is not a valid email address. No send.

### 6.5 Missing body

Type:

> Send an email to your.address@gmail.com

Expected: `needs_info` — email body is missing. No send.

### 6.6 Debug endpoints

```bash
curl -s http://localhost:4321/api/chat/intent  # intent events
curl -s http://localhost:4321/api/emails       # email outbox
```

---

## 7. Troubleshooting

### `Email failed: EMAIL_FROM (or SMTP_USER) must be set`

This happens when `EMAIL_FROM=` exists but is empty while `SMTP_USER` is set.
The current fallback uses `??`, which does not fall back for empty strings.

Workaround:

- set `EMAIL_FROM` to the same address as `SMTP_USER`; or
- delete the `EMAIL_FROM=` line entirely.

Recommended code fix:

```ts
const from = getEnv('EMAIL_FROM')?.trim() || user;
```

### `Invalid login` / SMTP 535

- Use a Google App Password, not the account password.
- Enable 2-Step Verification.
- Keep `SMTP_USER` and `EMAIL_FROM` consistent.
- Remove spaces from the App Password if needed.

### Still seeing mock behavior

- Confirm `INTENT_LLM_MOCK=false`.
- Confirm `GROQ_API_KEY` is set.
- Restart the dev server.
- Check the `mock` flag in the `/api/chat/intent` response.

### `needs_info`

The worker refused to send because a required field is missing or invalid. The
reason is shown on the intent card and in `GET /api/emails`.

### Groq 429

The provider retries `429`/`5xx` with backoff and respects `Retry-After`.
Free-tier limits still apply.

### Server won’t start after editing `.env`

Restart it:

```bash
# stop the current process, then
npm run dev
```

---

## 8. Security

- Keep API keys and SMTP credentials in `front-end/.env` only.
- `.env` is gitignored; never commit it.
- Never paste an App Password into chat or an issue.
- Rotate any credential that may have been exposed.
- The mock sender performs no network calls.
- User text is treated as untrusted data by the intent prompt.
