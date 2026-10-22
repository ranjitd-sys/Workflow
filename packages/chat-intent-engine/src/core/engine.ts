import {
  ChatIntentEngineError,
  EmptyMessageError,
  InvalidMessageError,
  LlmProviderError,
} from '../errors';
import type { StructuredLlmProvider } from '../providers/types';
import { DEFAULT_INTENTS } from '../taxonomy/definitions';
import { IntentRegistry } from '../taxonomy/registry';
import {
  chatIntentInputSchema,
  type ChatIntentInput,
  type ChatIntentResult,
  type IntentDefinition,
} from '../types';
import { prepareContext, toEvidenceText, type ContextLimits } from './context';
import {
  INTENT_SCHEMA_NAME,
  SYSTEM_PROMPT,
  buildChatJsonSchema,
  buildChatUserPrompt,
} from './prompt';
import { validateChatInterpretation } from './validate';

const DEFAULT_TIMEOUT_MS = 30_000;

export interface ChatIntentEngineOptions {
  /** Injected LLM provider. Tests supply a mock instead of calling a live API. */
  provider: StructuredLlmProvider;
  /** Intent taxonomy to constrain the model to. Defaults to the bundled taxonomy. */
  intents?: readonly IntentDefinition[];
  /** Pre-built registry. Takes precedence over `intents` when supplied. */
  registry?: IntentRegistry;
  maxMessageChars?: number;
  maxHistoryMessages?: number;
  maxHistoryChars?: number;
  timeoutMs?: number;
  strictEvidence?: boolean;
}

/**
 * Core chat intent-understanding service.
 *
 * It never replies, plans tasks, or executes actions. It only converts a chat
 * message plus supplied history into a validated interpretation.
 */
export class ChatIntentEngine {
  private readonly provider: StructuredLlmProvider;
  private readonly registry: IntentRegistry;
  private readonly limits: ContextLimits;
  private readonly timeoutMs: number;
  private readonly strictEvidence: boolean;

  constructor(options: ChatIntentEngineOptions) {
    if (!options.provider) {
      throw new ChatIntentEngineError('ChatIntentEngine requires an LLM provider.');
    }

    this.provider = options.provider;
    this.registry =
      options.registry ?? new IntentRegistry(options.intents ?? DEFAULT_INTENTS);
    this.limits = {
      maxMessageChars: options.maxMessageChars,
      maxHistoryMessages: options.maxHistoryMessages,
      maxHistoryChars: options.maxHistoryChars,
    };
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.strictEvidence = options.strictEvidence ?? true;
  }

  async detect(input: ChatIntentInput): Promise<ChatIntentResult> {
    const parsed = chatIntentInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new InvalidMessageError('Chat intent input is invalid.', parsed.error.issues, {
        cause: parsed.error,
      });
    }

    const trimmed = parsed.data.message.trim();
    if (!trimmed) {
      throw new EmptyMessageError('Cannot interpret an empty message.');
    }

    const prepared = prepareContext(trimmed, parsed.data.history ?? [], this.limits);
    const evidenceText = toEvidenceText(prepared.message, prepared.history);

    const user = buildChatUserPrompt({
      message: prepared.message,
      history: prepared.history,
      intents: this.registry.list(),
    });

    const raw = await this.generateStructured({
      system: SYSTEM_PROMPT,
      user,
      schemaName: INTENT_SCHEMA_NAME,
      jsonSchema: buildChatJsonSchema(this.registry.ids),
    });

    const result = validateChatInterpretation(raw, this.registry, evidenceText, {
      strictEvidence: this.strictEvidence,
      referenceDate: parsed.data.timestamp,
    });

    const assumptions = [...result.assumptions];
    if (prepared.messageTruncated) {
      assumptions.push('The message was truncated to fit the interpretation context limit.');
    }
    if (prepared.historyTruncated) {
      assumptions.push('Older history messages were omitted to fit the context limit.');
    }

    return { ...result, assumptions };
  }

  private async generateStructured(
    request: Omit<Parameters<StructuredLlmProvider['generateStructured']>[0], 'signal'>,
  ): Promise<unknown> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new LlmProviderError(`LLM request timed out after ${this.timeoutMs}ms.`));
      }, this.timeoutMs);
    });

    try {
      return await Promise.race([
        this.provider.generateStructured({ ...request, signal: controller.signal }),
        timeout,
      ]);
    } catch (error) {
      if (error instanceof ChatIntentEngineError) throw error;
      throw new LlmProviderError('LLM provider call failed.', { cause: error });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

/** Convenience wrapper for callers that do not need to keep an engine instance. */
export function detectIntent(
  input: ChatIntentInput,
  options: ChatIntentEngineOptions,
): Promise<ChatIntentResult> {
  return new ChatIntentEngine(options).detect(input);
}
