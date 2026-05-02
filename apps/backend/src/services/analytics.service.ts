import { query } from '../config/database';
import { env } from '../config/env';
import { getRedis } from '../config/redis';
import { logger } from '../utils/logger';

const STREAM_KEY = 'api_telemetry_stream';
const GROUP = 'analytics_workers';
const CONSUMER = `analytics-${process.pid}`;

export interface AdminMetricsSnapshot {
  generatedAt: string;
  windowMinutes: number;
  activeWindowMinutes: number;
  totals: { requestCount: number; uniqueUsers: number; activeUsers: number; averageLatencyMs: number };
  endpointUsage: Array<{ endpoint: string; requestCount: number; averageLatencyMs: number; p95LatencyMs: number; errorRatePercent: number }>;
}
interface EndpointMetricsRow { endpoint: string; request_count: string; average_latency_ms: string; p95_latency_ms: string; error_rate_percent: string }
interface TotalsRow { request_count: string; unique_users: string; average_latency_ms: string }
interface ActiveUsersRow { active_users: string }

export class AnalyticsService {
  private readonly redis = getRedis();
  private workerRunning = false;

  async enqueueApiTelemetry(input: { endpoint: string; method: string; statusCode: number; latencyMs: number; userId?: string; organizationId?: string; capturedAt: string }): Promise<void> {
    if (Math.random() > env.ANALYTICS_SAMPLE_RATE) return;
    const client = this.redis as { xadd?: (...args: string[]) => Promise<unknown>; call?: (...args: string[]) => Promise<unknown> };
    if (typeof client.xadd === 'function') {
      await client.xadd(STREAM_KEY, 'MAXLEN', '~', String(env.ANALYTICS_MAX_QUEUE_SIZE), '*', 'endpoint', input.endpoint, 'method', input.method, 'status_code', String(input.statusCode), 'latency_ms', String(Math.round(input.latencyMs)), 'user_id', input.userId ?? '', 'organization_id', input.organizationId ?? '', 'captured_at', input.capturedAt);
      return;
    }
    await this.redis.call('XADD', STREAM_KEY, 'MAXLEN', '~', String(env.ANALYTICS_MAX_QUEUE_SIZE), '*', 'endpoint', input.endpoint, 'method', input.method, 'status_code', String(input.statusCode), 'latency_ms', String(Math.round(input.latencyMs)), 'user_id', input.userId ?? '', 'organization_id', input.organizationId ?? '', 'captured_at', input.capturedAt);
  }

  async startWorker(): Promise<void> {
    if (this.workerRunning) return;
    this.workerRunning = true;
    await this.redis.call('XGROUP', 'CREATE', STREAM_KEY, GROUP, '0', 'MKSTREAM').catch(() => undefined);
    void this.runLoop();
  }
  stopWorker(): void { this.workerRunning = false; }

  private async runLoop(): Promise<void> {
    while (this.workerRunning) {
      try {
        const rows = await this.redis.call('XREADGROUP', 'GROUP', GROUP, CONSUMER, 'COUNT', String(env.ANALYTICS_BATCH_SIZE), 'BLOCK', '2000', 'STREAMS', STREAM_KEY, '>') as unknown[];
        if (!rows || rows.length === 0) continue;
        const streamRows = (rows[0] as [string, Array<[string, string[]]>])[1];
        for (const [id, vals] of streamRows) {
          const map: Record<string, string> = {};
          for (let i = 0; i < vals.length; i += 2) map[vals[i]] = vals[i + 1];
          await query('INSERT INTO api_request_metrics (endpoint, method, status_code, latency_ms, user_id, organization_id, created_at) VALUES ($1,$2,$3,$4,NULLIF($5,\'\')::uuid,NULLIF($6,\'\')::uuid,$7)', [map.endpoint, map.method, Number.parseInt(map.status_code, 10), Number.parseFloat(map.latency_ms), map.user_id ?? '', map.organization_id ?? '', map.captured_at]);
          await this.redis.call('XACK', STREAM_KEY, GROUP, id);
        }
      } catch (error) {
        logger.warn('Analytics worker loop failure', { error: error instanceof Error ? error.message : 'unknown' });
      }
    }
  }

  async enforceRetention(): Promise<void> {
    await query('DELETE FROM api_request_metrics WHERE created_at < NOW() - INTERVAL \"90 days\"');
  }

  async getAdminMetrics(windowMinutes = 60, activeWindowMinutes = 5): Promise<AdminMetricsSnapshot> { /* unchanged */
    const safeWindowMinutes = Number.isFinite(windowMinutes) ? Math.max(1, Math.floor(windowMinutes)) : 60;
    const safeActiveWindowMinutes = Number.isFinite(activeWindowMinutes) ? Math.max(1, Math.floor(activeWindowMinutes)) : 5;
    const [totalsRow] = await query<TotalsRow>(`SELECT COUNT(*)::text AS request_count, COUNT(DISTINCT user_id)::text AS unique_users, COALESCE(ROUND(AVG(latency_ms)::numeric, 2), 0)::text AS average_latency_ms FROM api_request_metrics WHERE created_at >= NOW() - ($1::text || ' minutes')::interval`, [safeWindowMinutes]);
    const [activeUsersRow] = await query<ActiveUsersRow>(`SELECT COUNT(DISTINCT user_id)::text AS active_users FROM api_request_metrics WHERE user_id IS NOT NULL AND created_at >= NOW() - ($1::text || ' minutes')::interval`, [safeActiveWindowMinutes]);
    const endpointRows = await query<EndpointMetricsRow>(`SELECT endpoint, COUNT(*)::text AS request_count, COALESCE(ROUND(AVG(latency_ms)::numeric, 2), 0)::text AS average_latency_ms, COALESCE(ROUND((percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms))::numeric, 2), 0)::text AS p95_latency_ms, COALESCE(ROUND((SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0)) * 100, 2), 0)::text AS error_rate_percent FROM api_request_metrics WHERE created_at >= NOW() - ($1::text || ' minutes')::interval GROUP BY endpoint ORDER BY COUNT(*) DESC, endpoint ASC`, [safeWindowMinutes]);
    return { generatedAt: new Date().toISOString(), windowMinutes: safeWindowMinutes, activeWindowMinutes: safeActiveWindowMinutes, totals: { requestCount: Number.parseInt(totalsRow?.request_count ?? '0', 10), uniqueUsers: Number.parseInt(totalsRow?.unique_users ?? '0', 10), activeUsers: Number.parseInt(activeUsersRow?.active_users ?? '0', 10), averageLatencyMs: Number.parseFloat(totalsRow?.average_latency_ms ?? '0') }, endpointUsage: endpointRows.map((row) => ({ endpoint: row.endpoint, requestCount: Number.parseInt(row.request_count, 10), averageLatencyMs: Number.parseFloat(row.average_latency_ms), p95LatencyMs: Number.parseFloat(row.p95_latency_ms), errorRatePercent: Number.parseFloat(row.error_rate_percent) })) };
  }
}

export const analyticsService = new AnalyticsService();
