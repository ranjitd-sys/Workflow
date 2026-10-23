import { useEffect, useRef, useState } from 'react';
import { useMachine } from '@xstate/react';
import {
  createSendEmailConversationMachine,
  type SendEmailActionIdentificationResult,
  type SendEmailParameterName,
} from '../../lib/chat/send-email-conversation-machine';
import {
  formatActionIdentifier,
  identifyAction,
  type ActionResponse,
} from '../../lib/action';
import { enqueueWorkflowAction, waitForWorkflowJob } from '../../lib/workflow';

const MAX_CLARIFICATION_ROUNDS = 2;

const sendEmailConversationMachine = createSendEmailConversationMachine();

const SUGGESTIONS = [
  { icon: '✉️', title: 'Send an email', prompt: 'Send an email to john@acme.com about the invoice.' },
  { icon: '🕒', title: 'Schedule an email', prompt: 'Schedule an email to john@acme.com for tomorrow at 9.' },
];

const PARAMETER_PROMPTS: Record<SendEmailParameterName, string> = {
  to: 'Who should receive the email?',
  subject: 'What should the subject be?',
  body: 'What should the email say?',
};

type TranscriptEntry =
  | { id: string; kind: 'user'; content: string }
  | { id: string; kind: 'action'; response: ActionResponse }
  | {
      id: string;
      kind: 'clarification';
      question: string;
      options: string[];
      response: ActionResponse;
    }
  | { id: string; kind: 'error'; message: string };

type ClarificationEntry = Extract<TranscriptEntry, { kind: 'clarification' }>;

interface ActiveClarification {
  entryId: string;
  response: ActionResponse;
  round: number;
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function buildHistory(
  entries: TranscriptEntry[],
): { role: 'user' | 'assistant'; content: string }[] {
  const history: { role: 'user' | 'assistant'; content: string }[] = [];

  for (const entry of entries) {
    if (entry.kind === 'user') {
      history.push({ role: 'user', content: entry.content });
    } else if (entry.kind === 'clarification') {
      history.push({ role: 'assistant', content: entry.question });
    } else if (entry.kind === 'action') {
      const { action } = entry.response.result;
      history.push({
        role: 'assistant',
        content: `Action: ${action.identifier ?? 'unknown'} (${action.status}). ${action.summary}`,
      });
    }
  }

  return history;
}

function buildClarification(response: ActionResponse): { question: string; options: string[] } {
  const { action } = response.result;

  if (action.status === 'ambiguous') {
    const options = [
      ...new Set([action.identifier, ...action.alternatives].filter((id): id is string => Boolean(id))),
    ];
    return {
      question:
        options.length > 0
          ? `I can interpret this as ${options.map(formatActionIdentifier).join(' or ')}. Which did you mean?`
          : 'What did you mean?',
      options,
    };
  }

  return {
    question: "I couldn't determine a supported action. What would you like to do?",
    options: response.supportedActions,
  };
}

function buildSentResponse(
  messageId: string,
  parameters: { to: string; subject: string; body: string },
): ActionResponse {
  return {
    result: {
      action: {
        identifier: 'send_email',
        status: 'clear',
        alternatives: [],
        summary: `Email sent to ${parameters.to}. Brevo message ID: ${messageId}.`,
      },
      parameters: [
        { name: 'to', value: parameters.to, normalized: parameters.to, evidence: 'confirmed' },
        { name: 'subject', value: parameters.subject, normalized: parameters.subject, evidence: 'confirmed' },
        { name: 'body', value: parameters.body, normalized: parameters.body, evidence: 'confirmed' },
      ],
      missing: [],
      assumptions: [],
      ambiguities: [],
    },
    event: null,
    mock: false,
    eventCount: 0,
    supportedActions: ['send_email', 'schedule_email'],
  };
}

function HexLogo() {
  return (
    <div className="w-16 h-16 mx-auto mb-6">
      <svg viewBox="0 0 64 64" className="w-full h-full">
        <polygon points="32,4 56,18 56,46 32,60 8,46 8,18" fill="#f5f5f5" />
        <polygon
          points="32,8 52,20 52,44 32,56 12,44 12,20"
          fill="none"
          stroke="#171717"
          strokeWidth="2.5"
        />
        <text x="32" y="38" textAnchor="middle" fontSize="22" fill="#171717" fontWeight="bold">
          ✦
        </text>
      </svg>
    </div>
  );
}

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[75%] rounded-2xl rounded-br-md bg-neutral-900 px-4 py-3 text-white">
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{content}</p>
      </div>
    </div>
  );
}

function ActionCard({ response }: { response: ActionResponse }) {
  const { action } = response.result;

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[85%] rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-400">
            Action Identifier
          </span>
          <span className="font-semibold text-neutral-900">
            {action.identifier ? formatActionIdentifier(action.identifier) : 'Unknown'}
          </span>
          <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] text-neutral-500">
            {action.status}
          </span>
          {response.mock && (
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500">
              mock
            </span>
          )}
        </div>

        {action.identifier && (
          <p className="mt-1 text-xs text-neutral-400">{action.identifier}</p>
        )}

        <p className="mt-2 text-sm text-neutral-700">{action.summary}</p>

        {action.alternatives.length > 0 && (
          <p className="mt-2 text-xs text-neutral-500">
            Alternatives: {action.alternatives.map(formatActionIdentifier).join(', ')}
          </p>
        )}

        {response.result.missing.length > 0 && (
          <p className="mt-2 text-xs text-neutral-500">
            Missing: {response.result.missing.join(', ')}
          </p>
        )}

        {response.result.parameters.length > 0 && (
          <div className="mt-3 space-y-1 text-xs text-neutral-600">
            {response.result.parameters.map((parameter) => (
              <p key={parameter.name}>
                {parameter.name}: {parameter.value}
              </p>
            ))}
          </div>
        )}

        <div className="mt-3 border-t border-neutral-100 pt-2 text-xs text-neutral-400">
          {response.event
            ? `Event fired · ${response.event.type} · ${response.event.id}`
            : 'No event fired'}
        </div>
      </div>
    </div>
  );
}

function ClarificationCard({
  entry,
  disabled,
  onChoose,
}: {
  entry: ClarificationEntry;
  disabled: boolean;
  onChoose: (entry: ClarificationEntry, actionIdentifier: string) => void;
}) {
  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[85%] rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
        <p className="text-[10px] font-medium uppercase tracking-wider text-neutral-400">
          Clarification
        </p>
        <p className="mt-1 text-sm text-neutral-800">{entry.question}</p>

        <div className="mt-3 flex flex-wrap gap-2">
          {entry.options.map((id) => (
            <button
              key={id}
              type="button"
              disabled={disabled}
              onClick={() => onChoose(entry, id)}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:border-neutral-900 hover:text-neutral-900 disabled:opacity-50"
            >
              {formatActionIdentifier(id)}
            </button>
          ))}
        </div>

        <p className="mt-2 text-xs text-neutral-400">Or type your answer below.</p>
      </div>
    </div>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[85%] rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
        <p className="text-[10px] font-medium uppercase tracking-wider text-neutral-400">Error</p>
        <p className="mt-1 text-sm text-neutral-700">{message}</p>
      </div>
    </div>
  );
}

interface Props {
  user: { id: string; name: string; email: string };
  onSignOut: () => void;
}

export default function Chat({ user, onSignOut }: Props) {
  const [state, sendConversationEvent, actor] = useMachine(sendEmailConversationMachine);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [input, setInput] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [clarification, setClarification] = useState<ActiveClarification | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionIdRef = useRef<string>('');
  const hasMessages = transcript.length > 0;
  const missingParameter = state.context.missing[0];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript, analyzing, state.value]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    try {
      let id = sessionStorage.getItem('chat_session_id');
      if (!id) {
        id = newId();
        sessionStorage.setItem('chat_session_id', id);
      }
      sessionIdRef.current = id;
    } catch {
      sessionIdRef.current = newId();
    }
  }, []);

  const append = (entry: TranscriptEntry): void => {
    setTranscript((prev) => [...prev, entry]);
  };

  const send = async (text?: string) => {
    const message = (text ?? input).trim();
    if (!message || analyzing) return;

    if (state.matches('collecting')) {
      const name = state.context.missing[0];
      if (!name) return;
      setInput('');
      append({ id: newId(), kind: 'user', content: message });
      sendConversationEvent({ type: 'PARAMETER_PROVIDED', name, value: message });
      return;
    }

    if (state.matches('confirming') || state.matches('executing')) return;

    const sessionId = sessionIdRef.current;
    if (!sessionId) return;

    if (state.matches('completed') || state.matches('failed') || state.matches('cancelled')) {
      sendConversationEvent({ type: 'RESET' });
    }

    sendConversationEvent({ type: 'SUBMIT_MESSAGE', message });

    const priorEntries = transcript;
    const activeClarification = clarification;

    setInput('');
    setAnalyzing(true);
    append({ id: newId(), kind: 'user', content: message });

    const actionMessageId = newId();
    const result = await identifyAction({
      message,
      history: buildHistory(priorEntries),
      sessionId,
      messageId: actionMessageId,
      timestamp: new Date().toISOString(),
    });

    if (!result.ok) {
      sendConversationEvent({ type: 'IDENTIFICATION_FAILED', error: result.error });
      append({ id: newId(), kind: 'error', message: result.error });
      setAnalyzing(false);
      return;
    }

    const response = result.response;
    const status = response.result.action.status;
    const identifier = response.result.action.identifier;

    if (status === 'clear' && identifier === 'send_email') {
      sendConversationEvent({
        type: 'IDENTIFIED',
        result: response.result as SendEmailActionIdentificationResult,
      });
      append({ id: newId(), kind: 'action', response });
      setClarification(null);
      setAnalyzing(false);
      return;
    }

    if (status === 'clear' && identifier === 'schedule_email') {
      append({ id: newId(), kind: 'action', response });
      append({
        id: newId(),
        kind: 'error',
        message: 'Scheduling is identified but not implemented yet. Send this email now instead.',
      });
      setClarification(null);
      setAnalyzing(false);
      return;
    }

    if (status === 'clear') {
      append({ id: newId(), kind: 'action', response });
      setClarification(null);
      setAnalyzing(false);
      return;
    }

    const nextRound = activeClarification ? activeClarification.round + 1 : 1;

    if (nextRound <= MAX_CLARIFICATION_ROUNDS) {
      const { question, options } = buildClarification(response);
      const entryId = newId();
      sendConversationEvent({
        type: 'NEEDS_CLARIFICATION',
        result: response.result as SendEmailActionIdentificationResult,
      });
      append({ id: entryId, kind: 'clarification', question, options, response });
      setClarification({ entryId, response, round: nextRound });
    } else {
      if (state.matches('clarifying')) sendConversationEvent({ type: 'RESET' });
      append({ id: newId(), kind: 'action', response });
      setClarification(null);
    }

    setAnalyzing(false);
  };

  const chooseOption = (entry: ClarificationEntry, actionIdentifier: string) => {
    if (analyzing) return;

    const response: ActionResponse = {
      ...entry.response,
      result: {
        ...entry.response.result,
        action: {
          identifier: actionIdentifier,
          status: 'clear',
          alternatives: [],
          summary: `You selected ${formatActionIdentifier(actionIdentifier)}.`,
        },
      },
    };

    if (actionIdentifier === 'send_email') {
      sendConversationEvent({
        type: 'CLARIFICATION_CHOSEN',
        result: response.result as SendEmailActionIdentificationResult,
      });
    } else if (state.matches('clarifying')) {
      sendConversationEvent({ type: 'RESET' });
    }

    append({ id: newId(), kind: 'action', response });
    setClarification(null);
  };

  const confirmSend = async () => {
    if (!state.matches('confirming')) return;

    const { to, subject, body } = state.context.parameters;
    if (!to || !subject || !body) {
      sendConversationEvent({ type: 'EDIT' });
      return;
    }

    sendConversationEvent({ type: 'CONFIRM' });
    const executing = actor.getSnapshot();
    if (!executing.matches('executing')) return;

    const enqueued = await enqueueWorkflowAction({
      actionId: 'send_email',
      parameters: { to, subject, body },
      sessionId: sessionIdRef.current || undefined,
    });

    if (!enqueued.ok) {
      sendConversationEvent({ type: 'EXECUTION_FAILED', error: enqueued.error });
      append({ id: newId(), kind: 'error', message: enqueued.error });
      return;
    }

    const execution = await waitForWorkflowJob(enqueued.eventId);

    if (!execution.ok) {
      sendConversationEvent({ type: 'EXECUTION_FAILED', error: execution.error });
      append({ id: newId(), kind: 'error', message: execution.error });
      return;
    }

    sendConversationEvent({ type: 'EXECUTION_SUCCEEDED', messageId: execution.messageId });
    append({
      id: newId(),
      kind: 'action',
      response: buildSentResponse(execution.messageId, { to, subject, body }),
    });
  };

  const startNewRequest = () => {
    sendConversationEvent({ type: 'RESET' });
    setClarification(null);
  };

  const inputDisabled = analyzing || state.matches('confirming') || state.matches('executing');

  return (
    <div className="flex flex-col h-screen bg-white">
      <header className="flex items-center justify-between px-6 py-4 border-b border-neutral-100">
        <div className="flex items-center gap-2.5">
          <svg viewBox="0 0 32 32" className="w-7 h-7">
            <polygon
              points="16,2 28,9 28,23 16,30 4,23 4,9"
              fill="none"
              stroke="#171717"
              strokeWidth="2"
            />
            <text x="16" y="21" textAnchor="middle" fontSize="14" fill="#171717">
              ✦
            </text>
          </svg>
          <span className="font-semibold text-neutral-900 text-lg">Action Engine</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-neutral-500 hidden sm:inline">{user.email}</span>
          <button
            onClick={onSignOut}
            className="text-sm text-neutral-600 hover:text-neutral-900 px-3 py-1.5 rounded-lg hover:bg-neutral-100 transition-colors"
          >
            Sign out
          </button>
          <div className="w-8 h-8 rounded-full bg-neutral-900 flex items-center justify-center text-white text-sm font-medium">
            {user.name.charAt(0).toUpperCase()}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {!hasMessages ? (
          <div className="flex flex-col items-center justify-center h-full px-4 pb-8">
            <HexLogo />
            <h1 className="text-2xl sm:text-3xl font-bold text-neutral-900 text-center mb-2">
              What do you want to do?
            </h1>
            <p className="text-neutral-500 text-center max-w-md mb-10 text-sm sm:text-base">
              Type a message. I’ll identify the action when it’s clear.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-2xl">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion.title}
                  onClick={() => send(suggestion.prompt)}
                  className="flex flex-col items-start gap-2 p-4 rounded-xl bg-neutral-50 border border-neutral-200 hover:border-neutral-400 hover:bg-neutral-100 hover:shadow-sm transition-all duration-200 text-left group"
                >
                  <span className="text-2xl">{suggestion.icon}</span>
                  <span className="font-medium text-neutral-700 text-sm group-hover:text-neutral-900">
                    {suggestion.title}
                  </span>
                  <span className="text-xs text-neutral-400 line-clamp-2">
                    {suggestion.prompt}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
            {transcript.map((entry) => {
              if (entry.kind === 'user') {
                return <UserBubble key={entry.id} content={entry.content} />;
              }
              if (entry.kind === 'action') {
                return <ActionCard key={entry.id} response={entry.response} />;
              }
              if (entry.kind === 'clarification') {
                return (
                  <ClarificationCard
                    key={entry.id}
                    entry={entry}
                    disabled={analyzing || clarification?.entryId !== entry.id}
                    onChoose={chooseOption}
                  />
                );
              }
              return <ErrorCard key={entry.id} message={entry.message} />;
            })}

            {analyzing && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-md border border-neutral-200 bg-white px-4 py-3 shadow-sm">
                  <div className="flex items-center gap-2 text-xs text-neutral-500">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-neutral-400" />
                    Identifying action…
                  </div>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="px-4 pb-4 pt-2 border-t border-neutral-100">
        {state.matches('collecting') && missingParameter && (
          <div className="max-w-3xl mx-auto mb-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
            <p className="text-[10px] font-medium uppercase tracking-wider text-neutral-400">
              Collecting details
            </p>
            <p className="mt-1 text-sm text-neutral-800">{PARAMETER_PROMPTS[missingParameter]}</p>
            <p className="mt-1 text-xs text-neutral-500">
              Still missing: {state.context.missing.join(', ')}
            </p>
            <button
              type="button"
              onClick={() => sendConversationEvent({ type: 'CANCEL' })}
              className="mt-2 text-xs text-neutral-500 hover:text-neutral-900"
            >
              Cancel
            </button>
          </div>
        )}

        {state.matches('confirming') && (
          <div className="max-w-3xl mx-auto mb-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
            <p className="text-[10px] font-medium uppercase tracking-wider text-neutral-400">
              Ready to send
            </p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-neutral-500">To</dt>
              <dd className="text-neutral-900">{state.context.parameters.to}</dd>
              <dt className="text-neutral-500">Subject</dt>
              <dd className="text-neutral-900">{state.context.parameters.subject}</dd>
              <dt className="text-neutral-500">Body</dt>
              <dd className="whitespace-pre-wrap text-neutral-900">{state.context.parameters.body}</dd>
            </dl>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => void confirmSend()}
                className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700"
              >
                Confirm and send
              </button>
              <button
                type="button"
                onClick={() => sendConversationEvent({ type: 'EDIT' })}
                className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:border-neutral-900 hover:text-neutral-900"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => sendConversationEvent({ type: 'CANCEL' })}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-neutral-500 hover:text-neutral-900"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {state.matches('executing') && (
          <div className="max-w-3xl mx-auto mb-3 rounded-2xl border border-neutral-200 bg-white p-4">
            <div className="flex items-center gap-2 text-xs text-neutral-500">
              <span className="h-2 w-2 animate-pulse rounded-full bg-neutral-400" />
              Waiting for the server workflow…
            </div>
          </div>
        )}

        {state.matches('completed') && (
          <div className="max-w-3xl mx-auto mb-3 rounded-2xl border border-neutral-200 bg-white p-4">
            <p className="text-sm text-neutral-800">
              Email sent. Message ID: {state.context.execution?.messageId}
            </p>
            <button
              type="button"
              onClick={startNewRequest}
              className="mt-2 text-xs text-neutral-500 hover:text-neutral-900"
            >
              New request
            </button>
          </div>
        )}

        {state.matches('failed') && (
          <div className="max-w-3xl mx-auto mb-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
            <p className="text-sm text-neutral-800">{state.context.error ?? 'Something went wrong.'}</p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => sendConversationEvent({ type: 'RETRY' })}
                className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:border-neutral-900 hover:text-neutral-900"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={startNewRequest}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-neutral-500 hover:text-neutral-900"
              >
                Start over
              </button>
            </div>
          </div>
        )}

        {state.matches('cancelled') && (
          <div className="max-w-3xl mx-auto mb-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
            <p className="text-sm text-neutral-800">Cancelled.</p>
            <button
              type="button"
              onClick={startNewRequest}
              className="mt-2 text-xs text-neutral-500 hover:text-neutral-900"
            >
              New request
            </button>
          </div>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
          className="max-w-3xl mx-auto flex items-center gap-2"
        >
          <div className="flex-1 relative">
            <input
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              className="w-full bg-white border border-neutral-200 rounded-2xl px-4 py-3 pr-12 text-sm text-neutral-900 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent shadow-sm"
              placeholder={
                state.matches('collecting')
                  ? 'Type your answer…'
                  : state.matches('confirming')
                    ? 'Confirm or edit above'
                    : 'Type a message…'
              }
              disabled={inputDisabled}
            />
            {input.trim() && !inputDisabled && (
              <button
                type="submit"
                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-xl bg-neutral-900 text-white flex items-center justify-center hover:bg-neutral-700 transition-colors"
                aria-label="Send"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 10l7-7m0 0l7 7m-7-7v18"
                  />
                </svg>
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
