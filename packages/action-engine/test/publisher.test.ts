import { describe, expect, it, vi } from 'vitest';
import { ActionEngine } from '../src/core/engine';
import { ActionEngineError, ActionValidationError } from '../src/errors';
import { ActionEventPublisher } from '../src/events/publisher';
import { InMemoryEventSink } from '../src/events/in-memory-sink';
import { createMockProvider, makeInput, makeResult, TEST_ACTIONS } from './helpers';

describe('ActionEventPublisher', () => {
  it('emits exactly one event for a clear action', async () => {
    const { provider } = createMockProvider({
      action: { identifier: 'test.action.one', status: 'clear', alternatives: [], summary: 'Clear.' },
      parameters: [],
      missing: [],
      assumptions: [],
      ambiguities: [],
    });
    const engine = new ActionEngine({ provider, actions: TEST_ACTIONS });
    const sink = new InMemoryEventSink();
    const publisher = new ActionEventPublisher({ engine, sink, emitFor: ['clear'] });

    const { result, event } = await publisher.handle(makeInput());

    expect(result.action.status).toBe('clear');
    expect(event).not.toBeNull();
    expect(event?.type).toBe('chat.action.identified');
    expect(sink.events).toHaveLength(1);
  });

  it('does not emit for an unknown action by default', async () => {
    const { provider } = createMockProvider({
      action: { identifier: null, status: 'unknown', alternatives: [], summary: 'Unknown.' },
      parameters: [],
      missing: [],
      assumptions: [],
      ambiguities: [],
    });
    const engine = new ActionEngine({ provider, actions: TEST_ACTIONS });
    const sink = new InMemoryEventSink();
    const publisher = new ActionEventPublisher({ engine, sink });

    const { event } = await publisher.handle(makeInput());

    expect(event).toBeNull();
    expect(sink.events).toHaveLength(0);
  });

  it('can publish a resolved result without calling the model', async () => {
    const { provider } = createMockProvider({});
    const engine = new ActionEngine({ provider, actions: TEST_ACTIONS });
    const sink = new InMemoryEventSink();
    const publisher = new ActionEventPublisher({ engine, sink, emitFor: ['clear'] });

    const result = makeResult();
    const { event } = await publisher.publish(result, { sessionId: 'session-1', messageId: 'message-1' });

    expect(event).not.toBeNull();
    expect(sink.events).toHaveLength(1);
  });

  it('deduplicates by messageId', async () => {
    const { provider } = createMockProvider({
      action: { identifier: 'test.action.one', status: 'clear', alternatives: [], summary: 'Clear.' },
      parameters: [],
      missing: [],
      assumptions: [],
      ambiguities: [],
    });
    const engine = new ActionEngine({ provider, actions: TEST_ACTIONS });
    const sink = new InMemoryEventSink();
    const publisher = new ActionEventPublisher({ engine, sink, emitFor: ['clear'] });

    await publisher.handle(makeInput({ messageId: 'dup' }));
    const second = await publisher.handle(makeInput({ messageId: 'dup' }));

    expect(second.event).toBeNull();
    expect(sink.events).toHaveLength(1);
  });

  it('requires sessionId', async () => {
    const { provider } = createMockProvider({});
    const engine = new ActionEngine({ provider, actions: TEST_ACTIONS });
    const sink = new InMemoryEventSink();
    const publisher = new ActionEventPublisher({ engine, sink });

    await expect(publisher.handle({ ...makeInput(), sessionId: '' })).rejects.toBeInstanceOf(ActionEngineError);
  });

  it('throws when sink fails during emit', async () => {
    const { provider } = createMockProvider({
      action: { identifier: 'test.action.one', status: 'clear', alternatives: [], summary: 'Clear.' },
      parameters: [],
      missing: [],
      assumptions: [],
      ambiguities: [],
    });
    const engine = new ActionEngine({ provider, actions: TEST_ACTIONS });
    const failingSink = { emit: vi.fn(async () => { throw new Error('sink failed'); }) };
    const publisher = new ActionEventPublisher({ engine, sink: failingSink, emitFor: ['clear'] });

    await expect(publisher.handle(makeInput())).rejects.toThrow();
  });
});
