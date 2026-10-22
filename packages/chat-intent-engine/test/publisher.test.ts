import { describe, expect, it } from 'vitest';
import { ChatIntentEngine } from '../src/core/engine';
import { ChatIntentEngineError, ChatIntentValidationError } from '../src/errors';
import { InMemoryEventSink } from '../src/events/in-memory-sink';
import { IntentEventPublisher } from '../src/events/publisher';
import { chatIntentEventSchema, type IntentEventSink } from '../src/events/types';
import { createMockProvider, makeInput, makeResult } from './helpers';

function buildPublisher(
  response: unknown,
  options: { emitFor?: ('clear' | 'ambiguous' | 'unknown')[] } = {},
) {
  const { provider } = createMockProvider(response);
  const engine = new ChatIntentEngine({ provider });
  const sink = new InMemoryEventSink();
  let counter = 0;
  const publisher = new IntentEventPublisher({
    engine,
    sink,
    emitFor: options.emitFor,
    idFactory: () => `event-${++counter}`,
    clock: () => new Date('2026-07-15T10:00:00Z'),
  });
  return { publisher, sink };
}

describe('IntentEventPublisher', () => {
  it('emits exactly one event for a clear intent', async () => {
    const { publisher, sink } = buildPublisher(makeResult());

    const { result, event } = await publisher.handle(
      makeInput({ sessionId: 'session-1', messageId: 'message-1' }),
    );

    expect(result.intent.status).toBe('clear');
    expect(event).not.toBeNull();
    expect(sink.events).toHaveLength(1);
    expect(event?.id).toBe('event-1');
    expect(event?.type).toBe('chat.intent.detected');
    expect(event?.version).toBe(1);
    expect(event?.occurredAt).toBe('2026-07-15T10:00:00.000Z');
    expect(event?.sessionId).toBe('session-1');
    expect(event?.messageId).toBe('message-1');
    expect(event?.source).toBe('chat');
    expect(chatIntentEventSchema.safeParse(event).success).toBe(true);
    expect((event as unknown as { message?: unknown }).message).toBeUndefined();
  });

  it('emits an event for an ambiguous intent with alternatives', async () => {
    const { publisher, sink } = buildPublisher(
      makeResult({
        intent: {
          primary: 'request',
          status: 'ambiguous',
          alternatives: ['question'],
          summary: 'Two plausible intents.',
        },
      }),
    );

    const { event } = await publisher.handle(makeInput({ messageId: 'message-2' }));

    expect(sink.events).toHaveLength(1);
    expect(event?.intent.status).toBe('ambiguous');
    expect(event?.intent.alternatives).toEqual(['question']);
  });

  it('does not emit for an unknown intent by default', async () => {
    const { publisher, sink } = buildPublisher(
      makeResult({
        intent: {
          primary: null,
          status: 'unknown',
          alternatives: [],
          summary: 'Not enough evidence.',
        },
      }),
    );

    const { event } = await publisher.handle(makeInput({ messageId: 'message-3' }));

    expect(event).toBeNull();
    expect(sink.events).toHaveLength(0);
  });

  it('can be configured to emit for unknown intents', async () => {
    const { publisher, sink } = buildPublisher(
      makeResult({
        intent: {
          primary: null,
          status: 'unknown',
          alternatives: [],
          summary: 'Not enough evidence.',
        },
      }),
      { emitFor: ['clear', 'ambiguous', 'unknown'] },
    );

    const { event } = await publisher.handle(makeInput({ messageId: 'message-4' }));

    expect(event).not.toBeNull();
    expect(sink.events).toHaveLength(1);
  });

  it('does not emit when the engine output is invalid', async () => {
    const { publisher, sink } = buildPublisher({ nonsense: true });

    await expect(publisher.handle(makeInput({ messageId: 'message-5' }))).rejects.toBeInstanceOf(
      ChatIntentValidationError,
    );
    expect(sink.events).toHaveLength(0);
  });

  it('deduplicates events with the same messageId', async () => {
    const { publisher, sink } = buildPublisher(makeResult());

    const first = await publisher.handle(makeInput({ messageId: 'same-id' }));
    const second = await publisher.handle(makeInput({ messageId: 'same-id' }));

    expect(first.event).not.toBeNull();
    expect(second.event).toBeNull();
    expect(sink.events).toHaveLength(1);
  });

  it('emits again for a different messageId', async () => {
    const { publisher, sink } = buildPublisher(makeResult());

    await publisher.handle(makeInput({ messageId: 'one' }));
    await publisher.handle(makeInput({ messageId: 'two' }));

    expect(sink.events).toHaveLength(2);
  });

  it('does not deduplicate when no messageId is supplied', async () => {
    const { publisher, sink } = buildPublisher(makeResult());

    await publisher.handle(makeInput({ messageId: undefined }));
    await publisher.handle(makeInput({ messageId: undefined }));

    expect(sink.events).toHaveLength(2);
  });

  it('requires a sessionId', async () => {
    const { publisher } = buildPublisher(makeResult());

    await expect(publisher.handle(makeInput({ sessionId: '' }))).rejects.toBeInstanceOf(
      ChatIntentEngineError,
    );
  });

  it('respects a restricted emitFor policy', async () => {
    const { publisher, sink } = buildPublisher(
      makeResult({
        intent: {
          primary: 'request',
          status: 'ambiguous',
          alternatives: ['question'],
          summary: 'Two plausible intents.',
        },
      }),
      { emitFor: ['clear'] },
    );

    const { event } = await publisher.handle(makeInput({ messageId: 'message-6' }));

    expect(event).toBeNull();
    expect(sink.events).toHaveLength(0);
  });

  it('propagates sink failures', async () => {
    const { provider } = createMockProvider(makeResult());
    const engine = new ChatIntentEngine({ provider });
    const failingSink: IntentEventSink = {
      async emit() {
        throw new Error('sink unavailable');
      },
    };
    const publisher = new IntentEventPublisher({ engine, sink: failingSink });

    await expect(publisher.handle(makeInput({ sessionId: 'session-1' }))).rejects.toThrow(
      'sink unavailable',
    );
  });
});
