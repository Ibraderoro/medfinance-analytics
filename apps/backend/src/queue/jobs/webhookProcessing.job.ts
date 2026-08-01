export const WEBHOOK_PROCESSING_JOB_NAME = 'process' as const;

export interface WebhookProcessingPayload {
  id: string;
  type: string;
  data?: { object?: unknown };
}

export function buildWebhookJobId(eventId: string): string {
  return eventId;
}
