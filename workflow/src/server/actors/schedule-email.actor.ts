export class ScheduleNotImplementedError extends Error {
  constructor() {
    super('schedule_email is not implemented yet.');
    this.name = 'ScheduleNotImplementedError';
  }
}

export async function scheduleEmailActor(): Promise<{ messageId?: string }> {
  throw new ScheduleNotImplementedError();
}
