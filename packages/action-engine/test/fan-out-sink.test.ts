import { describe, expect, it, vi } from 'vitest';
import { FanOutEventSink } from '../src/events/fan-out-sink';
import { InMemoryEventSink } from '../src/events/in-memory-sink';
import type { ActionIdentifiedEvent } from '../src/events/types';

function makeEvent(): ActionIdentifiedEvent {
  return {
    id: 'event-1',
    type: 'chat.action.identified',
    version: 1,
    occurredAt: '2026-07-15T10:00:00.000Z',
    sessionId: 'session-1',
    messageId: 'message-1',
    source: 'chat',
    action: {
      identifier: 'test.action.one',
      status: 'clear',
      alternatives: [],
      summary: 'Test.',
    },
    parameters: [],
    missing: [],
    assumptions: [],
    ambiguities: [],
  };
}

describe('FanOutEventSink', () => {
  it('forwards events to sinks and handlers', async () => {
    const sink = new InMemoryEventSink();
    const handler = vi.fn(async () => {});
    const fanOut = new FanOutEventSink({ sinks: [sink], handlers: [handler] });

    const event = makeEvent();
    await fanOut.emit(event);

    expect(sink.events).toHaveLength(1);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it('isolates failing sinks and handlers', async () => {
    const handler = vi.fn(async () => { throw new Error('handler failed'); });
    const fanOut = new FanOutEventSink({ handlers: [handler], onError: vi.fn() });

    await expect(fanOut.emit(makeEvent())).resolves.toBeUndefined();
  });
});
