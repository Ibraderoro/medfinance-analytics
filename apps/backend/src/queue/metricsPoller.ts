import { QUEUE_NAMES, dlqName, getQueue } from './queues';
import { metricsService } from '../services/metrics.service';
import { logger } from '../utils/logger';

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

  for (const name of queueNames) {
    try {
      const counts = await getQueue(name).getJobCounts(...STATES);
      for (const state of STATES) {
        metricsService.recordQueueDepth({ queue: name, state }, counts[state] ?? 0);
      }
    } catch (error) {
      logger.warn('Failed to poll queue depth metrics', {
        queue: name,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  lastPollAt = Date.now();
}

export function startMetricsPoller(intervalMs = 15_000): void {
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
