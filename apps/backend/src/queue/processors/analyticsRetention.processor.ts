import { analyticsService } from '../../services/analytics.service';

/**
 * Archives and deletes analytics rows past the retention window. Triggered
 * daily by the `analytics:retention` repeatable job, replacing the previous
 * bare `setInterval` in the web process.
 */
export async function processAnalyticsRetentionJob(): Promise<void> {
  await analyticsService.enforceRetention();
}
