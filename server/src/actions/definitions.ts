import type { ActionDefinition } from '@workflow-execution/action-engine';

export const APP_ACTIONS: ActionDefinition[] = [
  {
    id: 'send_email',
    name: 'Send Email',
    description: 'The user asks to send one email immediately.',
    examples: ['Send an email to john@acme.com about the invoice.', 'Email Sarah that I will be late.'],
    synonyms: ['email', 'send a message to', 'write to'],
    parameters: [
      { name: 'to', description: 'Recipient email address.', required: true },
      { name: 'subject', description: 'Email subject line.', required: true },
      { name: 'body', description: 'Email body.', required: true },
    ],
  },
  {
    id: 'schedule_email',
    name: 'Schedule Email',
    description: 'The user asks to send one email at a specified future time.',
    examples: ['Schedule an email to john@acme.com for tomorrow at 9.', 'Send an email to Sarah next Monday at 3pm.'],
    synonyms: ['send later', 'schedule a message', 'delayed email'],
    parameters: [
      { name: 'to', description: 'Recipient email address.', required: true },
      { name: 'subject', description: 'Email subject line.', required: true },
      { name: 'body', description: 'Email body.', required: true },
      { name: 'send_at', description: 'Requested future send time.', required: true },
    ],
  },
];
