import { query } from '../config/database';

export interface AdminMetricsSnapshot {
  generatedAt: string;
  windowMinutes: number;
  activeWindowMinutes: number;
  totals: {
    requestCount: number;
    uniqueUsers: number;
    activeUsers: number;
    averageLatencyMs: number;
  };
  endpointUsage: Array<{
    endpoint: string;
    requestCount: number;
    averageLatencyMs: number;
    p95LatencyMs: number;
    errorRatePercent: number;
  }>;
}

interface EndpointMetricsRow {
  endpoint: string;
  request_count: string;
  average_latency_ms: string;
  p95_latency_ms: string;
  error_rate_percent: string;
}

interface TotalsRow {
  request_count: string;
  unique_users: string;
  average_latency_ms: string;
}

interface ActiveUsersRow {
  active_users: string;
}

export class AnalyticsService {
  async recordApiRequest(input: {
    endpoint: string;
    method: string;
    statusCode: number;
    latencyMs: number;
    userId?: string;
    organizationId?: string;
  }): Promise<void> {
    await query(
      `INSERT INTO api_request_metrics
       (endpoint, method, status_code, latency_ms, user_id, organization_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.endpoint,
        input.method,
        input.statusCode,
        input.latencyMs,
        input.userId ?? null,
        input.organizationId ?? null,
      ],
    );
  }

  async getAdminMetrics(windowMinutes = 60, activeWindowMinutes = 5): Promise<AdminMetricsSnapshot> {
    const safeWindowMinutes = Number.isFinite(windowMinutes) ? Math.max(1, Math.floor(windowMinutes)) : 60;
    const safeActiveWindowMinutes = Number.isFinite(activeWindowMinutes)
      ? Math.max(1, Math.floor(activeWindowMinutes))
      : 5;

    const [totalsRow] = await query<TotalsRow>(
      `SELECT
        COUNT(*)::text AS request_count,
        COUNT(DISTINCT user_id)::text AS unique_users,
        COALESCE(ROUND(AVG(latency_ms)::numeric, 2), 0)::text AS average_latency_ms
       FROM api_request_metrics
       WHERE created_at >= NOW() - ($1::text || ' minutes')::interval`,
      [safeWindowMinutes],
    );

    const [activeUsersRow] = await query<ActiveUsersRow>(
      `SELECT COUNT(DISTINCT user_id)::text AS active_users
       FROM api_request_metrics
       WHERE user_id IS NOT NULL
       AND created_at >= NOW() - ($1::text || ' minutes')::interval`,
      [safeActiveWindowMinutes],
    );

    const endpointRows = await query<EndpointMetricsRow>(
      `SELECT
        endpoint,
        COUNT(*)::text AS request_count,
        COALESCE(ROUND(AVG(latency_ms)::numeric, 2), 0)::text AS average_latency_ms,
        COALESCE(
          ROUND((percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms))::numeric, 2),
          0
        )::text AS p95_latency_ms,
        COALESCE(
          ROUND((SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0)) * 100, 2),
          0
        )::text AS error_rate_percent
       FROM api_request_metrics
       WHERE created_at >= NOW() - ($1::text || ' minutes')::interval
       GROUP BY endpoint
       ORDER BY COUNT(*) DESC, endpoint ASC`,
      [safeWindowMinutes],
    );

    return {
      generatedAt: new Date().toISOString(),
      windowMinutes: safeWindowMinutes,
      activeWindowMinutes: safeActiveWindowMinutes,
      totals: {
        requestCount: Number.parseInt(totalsRow?.request_count ?? '0', 10),
        uniqueUsers: Number.parseInt(totalsRow?.unique_users ?? '0', 10),
        activeUsers: Number.parseInt(activeUsersRow?.active_users ?? '0', 10),
        averageLatencyMs: Number.parseFloat(totalsRow?.average_latency_ms ?? '0'),
      },
      endpointUsage: endpointRows.map((row) => ({
        endpoint: row.endpoint,
        requestCount: Number.parseInt(row.request_count, 10),
        averageLatencyMs: Number.parseFloat(row.average_latency_ms),
        p95LatencyMs: Number.parseFloat(row.p95_latency_ms),
        errorRatePercent: Number.parseFloat(row.error_rate_percent),
      })),
    };
  }
}

export const analyticsService = new AnalyticsService();
