import { Job, Worker } from 'bullmq';
import { getQueueRedisConnection } from '../config/queueRedis';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { metricsService } from '../services/metrics.service';
import { analyticsService } from '../services/analytics.service';
import { BillingService } from '../services/billing.service';
import { QUEUE_NAMES, QueueName, dlqName, getQueue } from './queues';
import { processWebhookJob } from './processors/webhookProcessing.processor';
import { processAnalyticsPersistJob } from './processors/analyticsPersist.processor';
import { processAnalyticsRetentionJob } from './processors/analyticsRetention.processor';
import { WebhookProcessingPayload } from './jobs/webhookProcessing.job';

const billingService = new BillingService();

const QUEUE_CONCURRENCY: Record<QueueName, number> = {
  [QUEUE_NAMES.BILLING_WEBHOOK]: env.WEBHOOK_QUEUE_CONCURRENCY,
  [QUEUE_NAMES.ANALYTICS_PERSIST]: env.ANALYTICS_PERSIST_QUEUE_CONCURRENCY,
  [QUEUE_NAMES.ANALYTICS_RETENTION]: env.ANALYTICS_RETENTION_QUEUE_CONCURRENCY,
};

const PROCESSORS: Record<QueueName, (job: Job) => Promise<void>> = {
  [QUEUE_NAMES.BILLING_WEBHOOK]: (job) => processWebhookJob(job as Job<WebhookProcessingPayload>),
  [QUEUE_NAMES.ANALYTICS_PERSIST]: () => processAnalyticsPersistJob(),
  [QUEUE_NAMES.ANALYTICS_RETENTION]: () => processAnalyticsRetentionJob(),
};

let workers: Worker[] = [];

function jobDurationMs(job: Job): number {
  const finishedOn = job.finishedOn ?? Date.now();
  const processedOn = job.processedOn ?? finishedOn;
  return Math.max(finishedOn - processedOn, 0);
}

/**
 * On final failure (attempts exhausted), route the job onto a real,
 * inspectable BullMQ dead-letter queue rather than relying solely on BullMQ's
 * own failed-job retention, and run any queue-specific cleanup.
 */
async function handleFinalFailure(name: QueueName, job: Job, error: Error): Promise<void> {
  logger.error('Job exhausted retries, routing to dead-letter queue', {
    queue: name,
    jobId: job.id,
    attemptsMade: job.attemptsMade,
    message: error.message,
  });
  metricsService.recordQueueDeadLetter({ queue: name });

  await getQueue(dlqName(name)).add(job.name, job.data, {
    jobId: job.id,
    removeOnComplete: { count: env.DLQ_RETENTION_COUNT },
  });

  if (name === QUEUE_NAMES.BILLING_WEBHOOK) {
    const payload = job.data as WebhookProcessingPayload;
    if (payload?.id) {
      await billingService.releaseWebhookEventReservation(payload.id).catch((releaseError: unknown) => {
        logger.error('Failed to release webhook reservation after DLQ routing', {
          eventId: payload.id,
          message: releaseError instanceof Error ? releaseError.message : String(releaseError),
        });
      });
    }
  }
}

/**
 * Instantiates one BullMQ Worker per queue and reclaims any analytics stream
 * entries left pending by a previously-crashed consumer before the persist
 * queue starts reading newly-delivered entries.
 */
export async function registerWorkers(): Promise<Worker[]> {
  await analyticsService.reclaimPendingOnce();

  workers = Object.values(QUEUE_NAMES).map((name) => {
    const worker = new Worker(name, PROCESSORS[name], {
      connection: getQueueRedisConnection(),
      concurrency: QUEUE_CONCURRENCY[name],
    });

    worker.on('completed', (job) => {
      metricsService.recordQueueJob(jobDurationMs(job), { queue: name, outcome: 'success' });
    });

    worker.on('failed', (job, error) => {
      if (!job) return;
      metricsService.recordQueueJob(jobDurationMs(job), { queue: name, outcome: 'failure' });

      const maxAttempts = job.opts.attempts ?? 1;
      if (job.attemptsMade >= maxAttempts) {
        void handleFinalFailure(name, job, error);
      }
    });

    worker.on('error', (error) => {
      logger.error('BullMQ worker error', { queue: name, message: error.message, stack: error.stack });
    });

    return worker;
  });

  return workers;
}

export async function closeWorkers(): Promise<void> {
  await Promise.all(workers.map((worker) => worker.close()));
  workers = [];
}
