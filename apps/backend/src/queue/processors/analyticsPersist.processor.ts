import { analyticsService } from '../../services/analytics.service';
import { CacheService } from '../../utils/cache';
import { liveFinancialsService } from '../../services/liveFinancials.service';

const financialsCache = new CacheService('financials');

/**
 * Drains and persists one batch of buffered API telemetry from the Redis
 * Stream consumer group. Triggered on a fixed cadence by the
 * `analytics:telemetry-persist` repeatable job rather than an internal loop.
 *
 * After each successful batch, any org whose data was touched has its cached
 * financial aggregates invalidated and a `kpi-updated` SSE event published so
 * connected dashboard clients refresh immediately.
 */
export async function processAnalyticsPersistJob(): Promise<void> {
  const { processed, orgIds } = await analyticsService.processOneBatch();

  if (!processed || orgIds.length === 0) {
    return;
  }

  const fiscalYear = new Date().getFullYear();

  await Promise.all(
    orgIds.map(async (orgId) => {
      await financialsCache.invalidateOrgCache(orgId);
      await liveFinancialsService.publishKpiUpdated(orgId, fiscalYear);
    }),
  );
}
