import { json } from '../http/json';
import { getWorkflowJob } from '../workflow/runtime';

export function handleWorkflowStatus(eventId: string | undefined): Response {
  if (!eventId) {
    return json({ error: 'eventId is required.' }, 400);
  }

  const job = getWorkflowJob(eventId);
  if (!job) {
    return json({ error: 'Workflow job not found.' }, 404);
  }

  return json(job);
}
