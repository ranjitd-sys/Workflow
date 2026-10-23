import type { ActionIdentifiedEvent, ActionEventSink } from './types';

/**
 * In-memory event sink for tests, local development, and callers that only
 * need the emitted events in-process.
 */
export class InMemoryEventSink implements ActionEventSink {
  private readonly stored: ActionIdentifiedEvent[] = [];

  get events(): readonly ActionIdentifiedEvent[] {
    return this.stored;
  }

  async emit(event: ActionIdentifiedEvent): Promise<void> {
    this.stored.push(event);
  }

  clear(): void {
    this.stored.length = 0;
  }
}
