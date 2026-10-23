import { env } from '../env';
import type { BrevoConfig } from './brevo';

export function getBrevoConfig(): BrevoConfig {
  return {
    apiKey: env('BREVO_API_KEY'),
    senderEmail: env('BREVO_SENDER_EMAIL'),
    senderName: env('BREVO_SENDER_NAME'),
  };
}
