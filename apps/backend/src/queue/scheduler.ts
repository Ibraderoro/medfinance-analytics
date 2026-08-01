import { QUEUE_NAMES, getQueue } from './queues';
import { env } from '../config/env';
import {
  ANALYTICS_PERSIST_JOB_NAME,
  ANALYTICS_PERSIST_REPEATABLE_JOB_ID,
} from './jobs/analyticsPersist.job';
import {
  ANALYTICS_RETENTION_JOB_NAME,
  ANALYTICS_RETENTION_REPEATABLE_JOB_ID,
} from './jobs/analyticsRetention.job';

/**
 * Upserts the worker's repeatable jobs. Uses BullMQ's job-scheduler API with a
 * deterministic scheduler id so re-running this on every worker boot updates
 * the existing schedule instead of creating a duplicate one.
 */
export async function scheduleRepeatableJobs(): Promise<void> {
  await getQueue(QUEUE_NAMES.ANALYTICS_PERSIST).upsertJobScheduler(
    ANALYTICS_PERSIST_REPEATABLE_JOB_ID,
    { every: env.ANALYTICS_PERSIST_TICK_INTERVAL_MS },
    { name: ANALYTICS_PERSIST_JOB_NAME, data: {} },
  );

  await getQueue(QUEUE_NAMES.ANALYTICS_RETENTION).upsertJobScheduler(
    ANALYTICS_RETENTION_REPEATABLE_JOB_ID,
    { every: env.ANALYTICS_RETENTION_SCHEDULE_MS },
    { name: ANALYTICS_RETENTION_JOB_NAME, data: {} },
  );
}
