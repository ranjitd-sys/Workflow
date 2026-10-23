import {
  ChatIntentEngine,
  FanOutEventSink,
  IntentEventPublisher,
  InMemoryEventSink,
  OpenAiCompatibleProvider,
  type StructuredLlmProvider,
} from '@workflow-execution/chat-intent-engine';
import { emailWorker } from './email-worker';
import { env } from './env';
import { createMockIntentProvider } from './mock-intent';

/** Shared in-memory event store for the lifetime of the server process. */
export const intentEventStore = new InMemoryEventSink();

/** Fan out each event to the debug store and the email worker. */
export const intentEventSink = new FanOutEventSink({
  sinks: [intentEventStore],
  handlers: [(event) => emailWorker.handle(event)],
  onError: (error) => {
    console.error(
      '[intent-event] handler failed:',
      error instanceof Error ? error.message : 'unknown error',
    );
  },
});

export interface IntentPublisherBundle {
  publisher: IntentEventPublisher;
  mock: boolean;
}

/**
 * Build a publisher for one request. Only `clear` intents emit events; ambiguous
 * or unknown results are returned to the caller so the UI can ask a clarifying
 * question first.
 */
export function createIntentPublisher(message: string): IntentPublisherBundle {
  const apiKey = env('INTENT_LLM_API_KEY') ?? env('GROQ_API_KEY');
  const useMock = env('INTENT_LLM_MOCK') === 'true' || !apiKey;

  let provider: StructuredLlmProvider;
  if (useMock) {
    provider = createMockIntentProvider(message);
  } else {
    provider = new OpenAiCompatibleProvider({
      apiKey,
      baseUrl: env('INTENT_LLM_BASE_URL') ?? 'https://api.groq.com/openai/v1',
      model: env('INTENT_LLM_MODEL') ?? 'openai/gpt-oss-20b',
      strict: env('INTENT_LLM_STRICT_JSON_SCHEMA') !== 'false',
    });
  }

  const engine = new ChatIntentEngine({ provider });
  const publisher = new IntentEventPublisher({
    engine,
    sink: intentEventSink,
    emitFor: ['clear'],
  });

  return { publisher, mock: useMock };
}
