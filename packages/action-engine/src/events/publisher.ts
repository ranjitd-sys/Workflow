import { randomUUID } from 'node:crypto';
import { ActionEngine } from '../core/engine';
import { ActionEngineError, ActionValidationError } from '../errors';
import type { ActionIdentificationInput, ActionIdentificationResult, ActionStatus } from '../types';
import {
  CHAT_ACTION_IDENTIFIED_EVENT_TYPE,
  actionIdentifiedEventSchema,
  type ActionIdentifiedEvent,
  type ActionEventSink,
} from './types';

export type EmittableStatus = Extract<ActionStatus, 'clear' | 'ambiguous' | 'unknown'>;

export interface ActionEventPublisherOptions {
  engine: ActionEngine;
  sink: ActionEventSink;
  emitFor?: readonly EmittableStatus[];
  dedupe?: boolean;
  idFactory?: () => string;
  clock?: () => Date;
}

export type PublishInput = ActionIdentificationInput & { sessionId: string };

export interface PublishResolvedInput {
  sessionId: string;
  messageId?: string;
}

export interface PublishResult {
  result: ActionIdentificationResult;
  event: ActionIdentifiedEvent | null;
}

const DEFAULT_EMIT_FOR: readonly EmittableStatus[] = ['clear'];

export class ActionEventPublisher {
  private readonly engine: ActionEngine;
  private readonly sink: ActionEventSink;
  private readonly emitFor: ReadonlySet<EmittableStatus>;
  private readonly dedupe: boolean;
  private readonly idFactory: () => string;
  private readonly clock: () => Date;
  private readonly seenMessageIds = new Set<string>();

  constructor(options: ActionEventPublisherOptions) {
    if (!options.engine) {
      throw new ActionEngineError('ActionEventPublisher requires an engine.');
    }
    if (!options.sink) {
      throw new ActionEngineError('ActionEventPublisher requires an event sink.');
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
      throw new ActionEngineError('sessionId is required to publish an action event.');
    }

    const result = await this.engine.identify(input);
    return this.publish(result, { sessionId, messageId: input.messageId });
  }

  async publish(
    result: ActionIdentificationResult,
    input: PublishResolvedInput,
  ): Promise<PublishResult> {
    const sessionId = input.sessionId?.trim();
    if (!sessionId) {
      throw new ActionEngineError('sessionId is required to publish an action event.');
    }

    if (!this.emitFor.has(result.action.status)) {
      return { result, event: null };
    }

    const messageId = input.messageId?.trim();
    if (this.dedupe && messageId && this.seenMessageIds.has(messageId)) {
      return { result, event: null };
    }

    const event = this.buildEvent(result, sessionId, messageId);
    const parsed = actionIdentifiedEventSchema.safeParse(event);
    if (!parsed.success) {
      throw new ActionValidationError(
        'Constructed action event does not match the expected event schema.',
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
    result: ActionIdentificationResult,
    sessionId: string,
    messageId: string | undefined,
  ): ActionIdentifiedEvent {
    const base: Omit<ActionIdentifiedEvent, 'messageId'> = {
      id: this.idFactory(),
      type: CHAT_ACTION_IDENTIFIED_EVENT_TYPE,
      version: 1 as const,
      occurredAt: this.clock().toISOString(),
      sessionId,
      source: 'chat' as const,
      action: result.action,
      parameters: result.parameters,
      missing: result.missing,
      assumptions: result.assumptions,
      ambiguities: result.ambiguities,
    };

    return messageId ? { ...base, messageId } : base;
  }
}
