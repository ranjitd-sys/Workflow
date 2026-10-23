import {
  ActionEngine,
  ActionEventPublisher,
  FanOutEventSink,
  InMemoryEventSink,
  OpenAiCompatibleProvider,
  type StructuredLlmProvider,
} from '@workflow-execution/action-engine';
import { env } from './env';
import { createMockActionProvider } from './mock-action';
import { APP_ACTIONS } from './actions/definitions';

export const actionEventStore = new InMemoryEventSink();

export const actionEventSink = new FanOutEventSink({
  sinks: [actionEventStore],
  handlers: [],
  onError: (error) => {
    console.error(
      '[action-event] handler failed:',
      error instanceof Error ? error.message : 'unknown error',
    );
  },
});

export interface ActionPublisherBundle {
  publisher: ActionEventPublisher;
  mock: boolean;
}

export function createActionPublisher(message: string): ActionPublisherBundle {
  const apiKey = env('ACTION_LLM_API_KEY') ?? env('GROQ_API_KEY');
  const useMock = env('ACTION_LLM_MOCK') === 'true' || !apiKey;

  let provider: StructuredLlmProvider;
  if (useMock) {
    provider = createMockActionProvider(message);
  } else {
    provider = new OpenAiCompatibleProvider({
      apiKey: apiKey as string,
      baseUrl: env('ACTION_LLM_BASE_URL') ?? 'https://api.groq.com/openai/v1',
      model: env('ACTION_LLM_MODEL') ?? 'openai/gpt-oss-20b',
      strict: env('ACTION_LLM_STRICT_JSON_SCHEMA') !== 'false',
    });
  }

  const engine = new ActionEngine({ provider, actions: APP_ACTIONS });
  const publisher = new ActionEventPublisher({
    engine,
    sink: actionEventSink,
    emitFor: ['clear'],
  });

  return { publisher, mock: useMock };
}
