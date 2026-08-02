import { QUEUE_NAMES, dlqName, getQueue } from './queues';
import { metricsService } from '../services/metrics.service';
import { logger } from '../utils/logger';
import { env } from '../config/env';

const STATES = ['waiting', 'active', 'delayed', 'failed', 'completed'] as const;

let lastPollAt: number | null = null;
let pollTimer: NodeJS.Timeout | null = null;

/**
 * `QueueEvents`/`Worker` events only give deltas (a job completed, a job
 * failed) — point-in-time queue depth requires polling `getJobCounts()`,
 * same as any cloud queue dashboard does for backlog gauges.
 */
async function pollOnce(): Promise<void> {
  const queueNames = [...Object.values(QUEUE_NAMES), ...Object.values(QUEUE_NAMES).map(dlqName)];
  let anySucceeded = false;

  for (const name of queueNames) {
    try {
      const counts = await getQueue(name).getJobCounts(...STATES);
      for (const state of STATES) {
        metricsService.recordQueueDepth({ queue: name, state }, counts[state] ?? 0);
      }
      anySucceeded = true;
    } catch (error) {
      logger.warn('Failed to poll queue depth metrics', {
        queue: name,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (anySucceeded) {
    lastPollAt = Date.now();
  }
}

export function startMetricsPoller(
  intervalMs = Math.max(1_000, Math.floor(env.WORKER_READY_STALE_THRESHOLD_MS / 4)),
): void {
  if (pollTimer) return;
  void pollOnce();
  pollTimer = setInterval(() => void pollOnce(), intervalMs);
}

export function stopMetricsPoller(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/** Used by the worker's `/ready` health check to detect a stalled poller. */
export function getLastPollAt(): number | null {
  return lastPollAt;
}
