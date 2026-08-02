import { query } from '../config/database';
import { env } from '../config/env';
import { getRedis } from '../config/redis';
import { logger } from '../utils/logger';
import os from 'node:os';

const STREAM_KEY = 'api_telemetry_stream';
const GROUP = 'analytics_workers';
const CONSUMER = `analytics-${process.pid}-${process.env.HOSTNAME || os.hostname()}`;

type TelemetryEvent = {
  endpoint: string;
  method: string;
  statusCode: number;
  latencyMs: number;
  userId?: string;
  organizationId?: string;
  capturedAt: string;
};

export class AnalyticsService {
  private readonly redis = getRedis();

  /**
   * Enqueues API telemetry into a durable Redis stream.
   * The write is sampled using ANALYTICS_SAMPLE_RATE.
   */
  async enqueueApiTelemetry(input: TelemetryEvent): Promise<void> {
    if (Math.random() > env.ANALYTICS_SAMPLE_RATE) return;
    const args = [STREAM_KEY, 'MAXLEN', '~', String(env.ANALYTICS_MAX_QUEUE_SIZE), '*', 'endpoint', input.endpoint, 'method', input.method, 'status_code', String(input.statusCode), 'latency_ms', String(Math.round(input.latencyMs)), 'user_id', input.userId ?? '', 'organization_id', input.organizationId ?? '', 'captured_at', input.capturedAt] as const;
    const client = this.redis as { xadd?: (...a: string[]) => Promise<unknown>; call?: (...a: string[]) => Promise<unknown> };
    if (typeof client.xadd === 'function') await client.xadd(...args);
    else if (typeof client.call === 'function') await client.call('XADD', ...args);
    // else: skip silently — Redis mock in test environments may not expose xadd/call.
  }

  /**
   * Ensures the consumer group exists. Idempotent (BUSYGROUP errors are
   * swallowed) and deliberately not cached on the instance — the underlying
   * stream/group can disappear independently of this service's lifetime (a
   * Redis flush, a manual `DEL`), so this is re-checked on every call rather
   * than trusting a boolean flag that could go stale.
   */
  private async ensureGroup(): Promise<void> {
    await this.redis.call('XGROUP', 'CREATE', STREAM_KEY, GROUP, '0', 'MKSTREAM').catch(() => undefined);
  }

  /**
   * Reclaims and reprocesses entries that were previously delivered to a now-dead
   * consumer but never acknowledged. Called once at worker startup, before the
   * repeatable persist-tick job starts reading newly-delivered entries.
   */
  async reclaimPendingOnce(): Promise<void> {
    await this.ensureGroup();
    let startId = '0-0';
    for (;;) {
      const reclaimed = await this.redis.call(
        'XAUTOCLAIM',
        STREAM_KEY,
        GROUP,
        CONSUMER,
        '60000',
        startId,
        'COUNT',
        String(env.ANALYTICS_BATCH_SIZE),
      ) as [string, Array<[string, string[]]>];
      const [nextStartId, entries] = reclaimed;
      if (entries && entries.length > 0) {
        await this.persistBatch(entries);
      }
      if (nextStartId === '0-0') {
        return;
      }
      startId = nextStartId;
    }
  }

  /**
   * Reads and persists one batch of newly-delivered stream entries for this
   * consumer. Invoked by the `analytics:telemetry-persist` repeatable BullMQ
   * job rather than an internal loop — the job's own retry/backoff covers
   * transient Postgres/Redis failures for "run one tick," while unacked stream
   * entries remain durable in the consumer group regardless (the Redis Stream
   * is the durability layer; BullMQ is the scheduling/retry layer on top).
   *
   * Returns whether any entries were read, so callers can decide whether to
   * immediately attempt another tick (queue is backed up) or wait for the
   * next scheduled tick.
   */
  async processOneBatch(): Promise<boolean> {
    await this.ensureGroup();
    const rows = await this.redis.call(
      'XREADGROUP',
      'GROUP',
      GROUP,
      CONSUMER,
      'COUNT',
      String(env.ANALYTICS_BATCH_SIZE),
      'STREAMS',
      STREAM_KEY,
      '>',
    ) as unknown[];
    if (!rows?.length) return false;
    const entries = (rows[0] as [string, Array<[string, string[]]>])[1];
    if (entries.length === 0) return false;
    await this.persistBatch(entries);
    return true;
  }

  /**
   * Persists a batch to PostgreSQL and acknowledges entries only after successful insert.
   */
  private async persistBatch(entries: Array<[string, string[]]>): Promise<void> {
    if (entries.length === 0) return;
    const values: string[] = [];
    const params: unknown[] = [];
    const ackIds: string[] = [];
    entries.forEach(([id, vals], i) => {
      const map: Record<string, string> = {};
      for (let j = 0; j < vals.length; j += 2) map[vals[j]] = vals[j + 1];
      const base = i * 7;
      values.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},NULLIF($${base + 5},'')::uuid,NULLIF($${base + 6},'')::uuid,$${base + 7})`);
      params.push(map.endpoint, map.method, Number.parseInt(map.status_code ?? '0', 10), Number.parseFloat(map.latency_ms ?? '0'), map.user_id ?? '', map.organization_id ?? '', map.captured_at);
      ackIds.push(id);
    });
    await query(`INSERT INTO api_request_metrics (endpoint, method, status_code, latency_ms, user_id, organization_id, created_at) VALUES ${values.join(',')}`, params);
    await this.redis.call('XACK', STREAM_KEY, GROUP, ...ackIds);
  }

  /**
   * Archives and removes metrics older than 90 days.
   */
  async enforceRetention(): Promise<void> {
    const retentionWindow = '90 days';
    try {
      await query(
        "INSERT INTO api_request_metrics_archive SELECT * FROM api_request_metrics WHERE created_at < NOW() - ($1::text)::interval ON CONFLICT DO NOTHING",
        [retentionWindow],
      );
      await query(
        "DELETE FROM api_request_metrics WHERE created_at < NOW() - ($1::text)::interval",
        [retentionWindow],
      );
    } catch (error) {
      logger.error('Analytics retention enforcement failed', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        error,
      });
      throw error;
    }
  }

  /**
   * Returns aggregate admin analytics for a given time window.
   */
  async getAdminMetrics(windowMinutes = 60, activeWindowMinutes = 5) {
    const safeWindowMinutes = Number.isFinite(windowMinutes) ? Math.max(1, Math.floor(windowMinutes)) : 60;
    const safeActiveWindowMinutes = Number.isFinite(activeWindowMinutes) ? Math.max(1, Math.floor(activeWindowMinutes)) : 5;
    const [totalsRow] = await query<{ request_count: string; unique_users: string; average_latency_ms: string }>(`SELECT COUNT(*)::text AS request_count, COUNT(DISTINCT user_id)::text AS unique_users, COALESCE(ROUND(AVG(latency_ms)::numeric, 2), 0)::text AS average_latency_ms FROM api_request_metrics WHERE created_at >= NOW() - ($1::text || ' minutes')::interval`, [safeWindowMinutes]);
    const [activeUsersRow] = await query<{ active_users: string }>(`SELECT COUNT(DISTINCT user_id)::text AS active_users FROM api_request_metrics WHERE user_id IS NOT NULL AND created_at >= NOW() - ($1::text || ' minutes')::interval`, [safeActiveWindowMinutes]);
    const endpointRows = await query<{ endpoint: string; request_count: string; average_latency_ms: string; p95_latency_ms: string; error_rate_percent: string }>(`SELECT endpoint, COUNT(*)::text AS request_count, COALESCE(ROUND(AVG(latency_ms)::numeric, 2), 0)::text AS average_latency_ms, COALESCE(ROUND((percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms))::numeric, 2), 0)::text AS p95_latency_ms, COALESCE(ROUND((SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0)) * 100, 2), 0)::text AS error_rate_percent FROM api_request_metrics WHERE created_at >= NOW() - ($1::text || ' minutes')::interval GROUP BY endpoint ORDER BY COUNT(*) DESC, endpoint ASC`, [safeWindowMinutes]);
    return { generatedAt: new Date().toISOString(), windowMinutes: safeWindowMinutes, activeWindowMinutes: safeActiveWindowMinutes, totals: { requestCount: Number.parseInt(totalsRow?.request_count ?? '0', 10), uniqueUsers: Number.parseInt(totalsRow?.unique_users ?? '0', 10), activeUsers: Number.parseInt(activeUsersRow?.active_users ?? '0', 10), averageLatencyMs: Number.parseFloat(totalsRow?.average_latency_ms ?? '0') }, endpointUsage: endpointRows.map((row) => ({ endpoint: row.endpoint, requestCount: Number.parseInt(row.request_count, 10), averageLatencyMs: Number.parseFloat(row.average_latency_ms), p95LatencyMs: Number.parseFloat(row.p95_latency_ms), errorRatePercent: Number.parseFloat(row.error_rate_percent) })) };
  }

}

export const analyticsService = new AnalyticsService();
