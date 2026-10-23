# Workflow package

This package contains the browser-side conversation machine and the shared
workflow contracts used by both the Astro front-end and the Bun API.

Server-only execution code lives in the top-level `server/` workspace:
`InMemoryWorkflowQueue`, the root XState machine, the send/schedule actors, and
the workflow runtime.

## Shared contracts

`src/contracts/workflow.ts` exports the action IDs, the
`workflow.action.requested` event shape, queue/job types, and the `WorkflowQueue`
interface.

## send_email

The client machine is created by `createSendEmailConversationMachine()` and exported from
`src/email/send-email.workflow.ts`.

States:

```text
idle
  -> identifying
  -> clarifying
  -> collecting
  -> confirming
  -> executing
  -> completed
  -> failed
  -> cancelled
```

Main events:

| Event | Purpose |
|---|---|
| `SUBMIT_MESSAGE` | Begin identification |
| `IDENTIFIED` | Store a clear result and route to collecting/confirming |
| `NEEDS_CLARIFICATION` | Store an ambiguous/unknown result |
| `CLARIFICATION_CHOSEN` | Apply a selected result |
| `PARAMETER_PROVIDED` | Merge one collected field |
| `CONFIRM` | Move to executing |
| `EDIT` | Re-open all required fields |
| `EXECUTION_SUCCEEDED` | Store the Brevo message ID |
| `EXECUTION_FAILED` | Store the error |
| `RETRY` / `RESET` / `CANCEL` | Recover or exit |

The machine is pure and performs no I/O. After `CONFIRM`, `Chat.tsx` calls the
Bun API to enqueue the confirmed action, polls job status, and sends the
execution result back into the machine. No workflow state is persisted; a page
refresh resets it.

## Add a new workflow

1. Add the client machine and shared contracts.
2. Export them from `src/index.ts`.
3. Add client tests in `test/`.
4. Add the server actor, root-machine state, and route wiring in `server/`.
5. Wire the UI in `front-end/src/components/chat/Chat.tsx`.
