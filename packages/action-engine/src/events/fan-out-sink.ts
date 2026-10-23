import type { ActionIdentifiedEvent, ActionEventSink } from './types';

export type ActionEventHandler = (event: ActionIdentifiedEvent) => void | Promise<void>;

export interface FanOutEventSinkOptions {
  sinks?: ActionEventSink[];
  handlers?: ActionEventHandler[];
  onError?: (error: unknown, event: ActionIdentifiedEvent) => void;
}

/**
 * Forwards each event to multiple sinks and handlers. A failing sink or handler
 * does not prevent the others from receiving the event.
 */
export class FanOutEventSink implements ActionEventSink {
  private readonly sinks: ActionEventSink[];
  private readonly handlers: ActionEventHandler[];
  private readonly onError?: (error: unknown, event: ActionIdentifiedEvent) => void;

  constructor(options: FanOutEventSinkOptions = {}) {
    this.sinks = options.sinks ?? [];
    this.handlers = options.handlers ?? [];
    this.onError = options.onError;
  }

  async emit(event: ActionIdentifiedEvent): Promise<void> {
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
