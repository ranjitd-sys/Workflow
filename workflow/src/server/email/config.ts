import type { BrevoConfig } from './brevo';

export function getBrevoConfig(): BrevoConfig {
  return {
    apiKey: process.env.BREVO_API_KEY,
    senderEmail: process.env.BREVO_SENDER_EMAIL,
    senderName: process.env.BREVO_SENDER_NAME,
  };
}
