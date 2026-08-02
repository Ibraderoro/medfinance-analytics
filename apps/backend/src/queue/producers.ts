import { QUEUE_NAMES, defaultJobOptions, getQueue } from './queues';
import {
  WEBHOOK_PROCESSING_JOB_NAME,
  WebhookProcessingPayload,
  buildWebhookJobId,
} from './jobs/webhookProcessing.job';

/**
 * Enqueues durable processing of a verified, deduped Stripe webhook event.
 * Signature verification, Redis NX dedupe, and the Postgres reservation
 * happen inline in the HTTP handler before this is called — only the
 * business-logic call (`billingService.handleWebhookEvent`) is queued.
 *
 * The BullMQ jobId is the Stripe event id, so a duplicate enqueue for the
 * same event is a no-op at the queue layer (belt-and-suspenders alongside
 * the controller's own dedupe).
 */
export async function enqueueWebhookProcessing(event: WebhookProcessingPayload): Promise<void> {
  const queue = getQueue(QUEUE_NAMES.BILLING_WEBHOOK);
  await queue.add(WEBHOOK_PROCESSING_JOB_NAME, event, {
    ...defaultJobOptions(QUEUE_NAMES.BILLING_WEBHOOK),
    jobId: buildWebhookJobId(event.id),
  });
}
