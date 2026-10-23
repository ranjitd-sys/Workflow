import { ActionEngineError, EmptyMessageError, InvalidMessageError, LlmProviderError } from '../errors';
import type { StructuredLlmProvider } from '../providers/types';
import { ActionRegistry } from '../taxonomy/registry';
import {
  actionIdentificationInputSchema,
  type ActionDefinition,
  type ActionIdentificationInput,
  type ActionIdentificationResult,
} from '../types';
import { prepareContext, toEvidenceText, type ContextLimits } from './context';
import {
  ACTION_SCHEMA_NAME,
  SYSTEM_PROMPT,
  buildActionJsonSchema,
  buildActionUserPrompt,
} from './prompt';
import { validateActionIdentification } from './validate';

const DEFAULT_TIMEOUT_MS = 30_000;

export interface ActionEngineOptions {
  provider: StructuredLlmProvider;
  actions?: readonly ActionDefinition[];
  registry?: ActionRegistry;
  maxMessageChars?: number;
  maxHistoryMessages?: number;
  maxHistoryChars?: number;
  timeoutMs?: number;
  strictEvidence?: boolean;
}

export class ActionEngine {
  private readonly provider: StructuredLlmProvider;
  private readonly registry: ActionRegistry;
  private readonly limits: ContextLimits;
  private readonly timeoutMs: number;
  private readonly strictEvidence: boolean;

  constructor(options: ActionEngineOptions) {
    if (!options.provider) {
      throw new ActionEngineError('ActionEngine requires an LLM provider.');
    }

    if (options.registry) {
      this.registry = options.registry;
    } else if (options.actions) {
      this.registry = new ActionRegistry(options.actions);
    } else {
      throw new ActionEngineError('ActionEngine requires an action catalog or registry.');
    }

    this.provider = options.provider;
    this.limits = {
      maxMessageChars: options.maxMessageChars,
      maxHistoryMessages: options.maxHistoryMessages,
      maxHistoryChars: options.maxHistoryChars,
    };
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.strictEvidence = options.strictEvidence ?? true;
  }

  async identify(input: ActionIdentificationInput): Promise<ActionIdentificationResult> {
    const parsed = actionIdentificationInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new InvalidMessageError('Action identification input is invalid.', parsed.error.issues, {
        cause: parsed.error,
      });
    }

    const trimmed = parsed.data.message.trim();
    if (!trimmed) {
      throw new EmptyMessageError('Cannot interpret an empty message.');
    }

    const prepared = prepareContext(trimmed, parsed.data.history ?? [], this.limits);
    const evidenceText = toEvidenceText(prepared.message, prepared.history);

    const user = buildActionUserPrompt({
      message: prepared.message,
      history: prepared.history,
      actions: this.registry.list(),
    });

    const raw = await this.generateStructured({
      system: SYSTEM_PROMPT,
      user,
      schemaName: ACTION_SCHEMA_NAME,
      jsonSchema: buildActionJsonSchema(this.registry.ids),
    });

    const result = validateActionIdentification(raw, this.registry, evidenceText, {
      strictEvidence: this.strictEvidence,
      referenceDate: parsed.data.timestamp,
    });

    const assumptions = [...result.assumptions];
    if (prepared.messageTruncated) {
      assumptions.push('The message was truncated to fit the identification context limit.');
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
      if (error instanceof ActionEngineError) throw error;
      throw new LlmProviderError('LLM provider call failed.', { cause: error });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

export function identifyAction(
  input: ActionIdentificationInput,
  options: ActionEngineOptions,
): Promise<ActionIdentificationResult> {
  return new ActionEngine(options).identify(input);
}
