import { json } from '../http/json';
import { getWorkflowJob, WorkflowServiceError } from '../workflow-client';

export async function handleWorkflowStatus(eventId: string | undefined): Promise<Response> {
  if (!eventId) {
    return json({ error: 'eventId is required.' }, 400);
  }

  try {
    const job = await getWorkflowJob(eventId);
    if (!job) {
      return json({ error: 'Workflow job not found.' }, 404);
    }

    return json(job);
  } catch (error) {
    if (error instanceof WorkflowServiceError) {
      return json({ error: error.message }, error.status);
    }
    return json({ error: 'Failed to read workflow status.' }, 502);
  }
}
