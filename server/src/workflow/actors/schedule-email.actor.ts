import { fromPromise } from 'xstate';

export class ScheduleNotImplementedError extends Error {
  constructor() {
    super('schedule_email is not implemented yet.');
    this.name = 'ScheduleNotImplementedError';
  }
}

export const scheduleEmailActor = fromPromise(async () => {
  throw new ScheduleNotImplementedError();
});
