import { randomUUID } from 'node:crypto';
import { ChatIntentEngine } from '../core/engine';
import { ChatIntentEngineError, ChatIntentValidationError } from '../errors';
import type { ChatIntentInput, ChatIntentResult, IntentStatus } from '../types';
import {
  CHAT_INTENT_EVENT_TYPE,
  chatIntentEventSchema,
  type ChatIntentEvent,
  type IntentEventSink,
} from './types';

export type EmittableStatus = Extract<IntentStatus, 'clear' | 'ambiguous' | 'unknown'>;

export interface IntentEventPublisherOptions {
  engine: ChatIntentEngine;
  sink: IntentEventSink;
  /** Statuses that should produce an event. Defaults to clear + ambiguous. */
  emitFor?: readonly EmittableStatus[];
  /** Suppress duplicate events for the same messageId. Defaults to true. */
  dedupe?: boolean;
  idFactory?: () => string;
  clock?: () => Date;
}

export type PublishInput = ChatIntentInput & { sessionId: string };

export interface PublishResult {
  result: ChatIntentResult;
  event: ChatIntentEvent | null;
}

const DEFAULT_EMIT_FOR: readonly EmittableStatus[] = ['clear', 'ambiguous'];

/**
 * Wraps the pure intent engine with event construction and emission.
 * The engine itself never emits anything.
 */
export class IntentEventPublisher {
  private readonly engine: ChatIntentEngine;
  private readonly sink: IntentEventSink;
  private readonly emitFor: ReadonlySet<EmittableStatus>;
  private readonly dedupe: boolean;
  private readonly idFactory: () => string;
  private readonly clock: () => Date;
  private readonly seenMessageIds = new Set<string>();

  constructor(options: IntentEventPublisherOptions) {
    if (!options.engine) {
      throw new ChatIntentEngineError('IntentEventPublisher requires an engine.');
    }
    if (!options.sink) {
      throw new ChatIntentEngineError('IntentEventPublisher requires an event sink.');
    }

    this.engine = options.engine;
    this.sink = options.sink;
    this.emitFor = new Set(options.emitFor ?? DEFAULT_EMIT_FOR);
    this.dedupe = options.dedupe ?? true;
    this.idFactory = options.idFactory ?? (() => randomUUID());
    this.clock = options.clock ?? (() => new Date());
  }

  async handle(input: PublishInput): Promise<PublishResult> {
    const sessionId = input.sessionId?.trim();
    if (!sessionId) {
      throw new ChatIntentEngineError('sessionId is required to publish an intent event.');
    }

    const result = await this.engine.detect(input);

    if (!this.emitFor.has(result.intent.status)) {
      return { result, event: null };
    }

    const messageId = input.messageId?.trim();
    if (this.dedupe && messageId && this.seenMessageIds.has(messageId)) {
      return { result, event: null };
    }

    const event = this.buildEvent(result, sessionId, messageId);
    const parsed = chatIntentEventSchema.safeParse(event);
    if (!parsed.success) {
      throw new ChatIntentValidationError(
        'Constructed intent event does not match the expected event schema.',
        parsed.error.issues,
        { cause: parsed.error },
      );
    }

    await this.sink.emit(parsed.data);

    if (this.dedupe && messageId) {
      this.seenMessageIds.add(messageId);
    }

    return { result, event: parsed.data };
  }

  private buildEvent(
    result: ChatIntentResult,
    sessionId: string,
    messageId: string | undefined,
  ): ChatIntentEvent {
    const base: Omit<ChatIntentEvent, 'messageId'> = {
      id: this.idFactory(),
      type: CHAT_INTENT_EVENT_TYPE,
      version: 1 as const,
      occurredAt: this.clock().toISOString(),
      sessionId,
      source: 'chat' as const,
      intent: result.intent,
      entities: result.entities,
      actionItems: result.actionItems,
      questions: result.questions,
      urgency: result.urgency,
      replyRequired: result.replyRequired,
      unknowns: result.unknowns,
      assumptions: result.assumptions,
      ambiguities: result.ambiguities,
    };

    return messageId ? { ...base, messageId } : base;
  }
}
