import type { ChatIntentEvent, IntentEventSink } from './types';

export type IntentEventHandler = (event: ChatIntentEvent) => void | Promise<void>;

export interface FanOutEventSinkOptions {
  sinks?: IntentEventSink[];
  handlers?: IntentEventHandler[];
  onError?: (error: unknown, event: ChatIntentEvent) => void;
}

/**
 * Forwards each event to multiple sinks and handlers. A failing sink or handler
 * does not prevent the others from receiving the event.
 */
export class FanOutEventSink implements IntentEventSink {
  private readonly sinks: IntentEventSink[];
  private readonly handlers: IntentEventHandler[];
  private readonly onError?: (error: unknown, event: ChatIntentEvent) => void;

  constructor(options: FanOutEventSinkOptions = {}) {
    this.sinks = options.sinks ?? [];
    this.handlers = options.handlers ?? [];
    this.onError = options.onError;
  }

  async emit(event: ChatIntentEvent): Promise<void> {
    for (const sink of this.sinks) {
      try {
        await sink.emit(event);
      } catch (error) {
        this.onError?.(error, event);
      }
    }

    for (const handler of this.handlers) {
      try {
        await handler(event);
      } catch (error) {
        this.onError?.(error, event);
      }
    }
  }
}
