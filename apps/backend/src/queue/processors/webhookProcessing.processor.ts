import { Job } from 'bullmq';
import { BillingService } from '../../services/billing.service';
import { logger } from '../../utils/logger';
import { WebhookProcessingPayload } from '../jobs/webhookProcessing.job';

const billingService = new BillingService();

/**
 * Thin adapter around the existing billing business logic. Signature
 * verification, Redis dedupe, and the Postgres reservation already happened
 * inline in the HTTP handler before this job was enqueued — this processor
 * only runs `handleWebhookEvent` and marks the reservation processed on
 * success. On a retryable failure it rethrows and lets BullMQ's backoff
 * policy schedule the next attempt; the reservation is only released once
 * attempts are exhausted (see the queue's `failed` listener / DLQ handler).
 */
export async function processWebhookJob(job: Job<WebhookProcessingPayload>): Promise<void> {
  const event = job.data;
  try {
    await billingService.handleWebhookEvent(event);
    if (event.id) {
      await billingService.markWebhookEventProcessed(event.id);
    }
  } catch (error) {
    logger.warn('Webhook processing job attempt failed', {
      eventId: event.id,
      eventType: event.type,
      attempt: job.attemptsMade + 1,
      maxAttempts: job.opts.attempts,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
