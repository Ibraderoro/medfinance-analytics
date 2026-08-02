import { JobsOptions, Queue, QueueOptions } from 'bullmq';
import { getQueueRedisConnection } from '../config/queueRedis';
import { env } from '../config/env';

// BullMQ queue names may not contain ':' (it reserves that for its own Redis
// key namespacing), so queue/purpose is separated with '.' instead.
export const QUEUE_NAMES = {
  BILLING_WEBHOOK: 'billing.webhook-processing',
  ANALYTICS_PERSIST: 'analytics.telemetry-persist',
  ANALYTICS_RETENTION: 'analytics.retention',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export function dlqName(name: QueueName): string {
  return `${name}.dlq`;
}

const DEFAULT_JOB_OPTIONS: Record<QueueName, JobsOptions> = {
  [QUEUE_NAMES.BILLING_WEBHOOK]: {
    attempts: env.WEBHOOK_QUEUE_ATTEMPTS,
    backoff: { type: 'exponential', delay: env.WEBHOOK_QUEUE_BACKOFF_MS },
    removeOnComplete: { count: 1_000 },
    removeOnFail: { count: env.DLQ_RETENTION_COUNT },
  },
  [QUEUE_NAMES.ANALYTICS_PERSIST]: {
    attempts: env.ANALYTICS_PERSIST_QUEUE_ATTEMPTS,
    backoff: { type: 'exponential', delay: env.ANALYTICS_PERSIST_QUEUE_BACKOFF_MS },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: env.DLQ_RETENTION_COUNT },
  },
  [QUEUE_NAMES.ANALYTICS_RETENTION]: {
    attempts: env.ANALYTICS_RETENTION_QUEUE_ATTEMPTS,
    backoff: { type: 'exponential', delay: env.ANALYTICS_RETENTION_QUEUE_BACKOFF_MS },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: env.DLQ_RETENTION_COUNT },
  },
};

export function defaultJobOptions(name: QueueName): JobsOptions {
  return DEFAULT_JOB_OPTIONS[name];
}

const queues = new Map<string, Queue>();

function buildQueueOptions(): QueueOptions {
  return { connection: getQueueRedisConnection() };
}

/**
 * Memoized BullMQ Queue factory. Also used to construct dead-letter queues
 * (name = `${queueName}:dlq`), which are real, inspectable BullMQ queues rather
 * than relying solely on BullMQ's own `failed` job retention.
 */
export function getQueue(name: string): Queue {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, buildQueueOptions());
    queues.set(name, queue);
  }
  return queue;
}

export async function closeAllQueues(): Promise<void> {
  await Promise.all(Array.from(queues.values()).map((queue) => queue.close()));
  queues.clear();
}
