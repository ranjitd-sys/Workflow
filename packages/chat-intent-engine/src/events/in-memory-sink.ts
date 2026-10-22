import type { ChatIntentEvent, IntentEventSink } from './types';

/**
 * In-memory event sink for tests, local development, and callers that only
 * need the emitted events in-process.
 */
export class InMemoryEventSink implements IntentEventSink {
  private readonly stored: ChatIntentEvent[] = [];

  get events(): readonly ChatIntentEvent[] {
    return this.stored;
  }

  async emit(event: ChatIntentEvent): Promise<void> {
    this.stored.push(event);
  }

  clear(): void {
    this.stored.length = 0;
  }
}
