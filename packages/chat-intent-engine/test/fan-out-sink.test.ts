import { describe, expect, it, vi } from 'vitest';
import { FanOutEventSink } from '../src/events/fan-out-sink';
import { InMemoryEventSink } from '../src/events/in-memory-sink';
import type { ChatIntentEvent } from '../src/events/types';

function makeEvent(): ChatIntentEvent {
  return {
    id: 'event-1',
    type: 'chat.intent.detected',
    version: 1,
    occurredAt: '2026-07-15T10:00:00.000Z',
    sessionId: 'session-1',
    source: 'chat',
    intent: {
      primary: 'send_email',
      status: 'clear',
      alternatives: [],
      summary: 'Send an email to john@acme.com.',
    },
    entities: [],
    parameters: [
      {
        name: 'recipient',
        value: 'john@acme.com',
        normalized: null,
        evidence: 'john@acme.com',
      },
    ],
    actionItems: [],
    questions: [],
    urgency: 'unknown',
    replyRequired: null,
    unknowns: [],
    assumptions: [],
    ambiguities: [],
  };
}

describe('FanOutEventSink', () => {
  it('forwards an event to every sink and handler', async () => {
    const first = new InMemoryEventSink();
    const second = new InMemoryEventSink();
    const handler = vi.fn();

    const fanOut = new FanOutEventSink({
      sinks: [first, second],
      handlers: [handler],
    });

    await fanOut.emit(makeEvent());

    expect(first.events).toHaveLength(1);
    expect(second.events).toHaveLength(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: 'event-1' }));
  });

  it('continues when a sink or handler fails', async () => {
    const good = new InMemoryEventSink();
    const bad = {
      async emit() {
        throw new Error('bad sink');
      },
    };
    const onError = vi.fn();

    const fanOut = new FanOutEventSink({
      sinks: [bad, good],
      handlers: [
        () => {
          throw new Error('bad handler');
        },
      ],
      onError,
    });

    await fanOut.emit(makeEvent());

    expect(good.events).toHaveLength(1);
    expect(onError).toHaveBeenCalledTimes(2);
  });
});
