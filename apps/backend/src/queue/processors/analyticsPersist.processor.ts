import { analyticsService } from '../../services/analytics.service';

/**
 * Drains and persists one batch of buffered API telemetry from the Redis
 * Stream consumer group. Triggered on a fixed cadence by the
 * `analytics:telemetry-persist` repeatable job rather than an internal loop.
 */
export async function processAnalyticsPersistJob(): Promise<void> {
  await analyticsService.processOneBatch();
}
