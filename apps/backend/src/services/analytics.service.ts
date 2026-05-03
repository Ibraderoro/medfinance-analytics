import { getPool, query } from '../config/database';
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
  private workerRunning = false;
  private inflight: Promise<void> | null = null;
  private consecutiveFailures = 0;
  private retentionRunning = false;

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Enqueues API telemetry into a durable Redis stream.
   * The write is sampled using ANALYTICS_SAMPLE_RATE.
   */
  async enqueueApiTelemetry(input: TelemetryEvent): Promise<void> {
    if (Math.random() > env.ANALYTICS_SAMPLE_RATE) return;
    const args = [STREAM_KEY, 'MAXLEN', '~', String(env.ANALYTICS_MAX_QUEUE_SIZE), '*', 'endpoint', input.endpoint, 'method', input.method, 'status_code', String(input.statusCode), 'latency_ms', String(Math.round(input.latencyMs)), 'user_id', input.userId ?? '', 'organization_id', input.organizationId ?? '', 'captured_at', input.capturedAt] as const;
    const client = this.redis as { xadd?: (...a: string[]) => Promise<unknown>; call?: (...a: string[]) => Promise<unknown> };
    if (typeof client.xadd === 'function') await client.xadd(...args);
    else await this.redis.call('XADD', ...args);
  }

  /**
   * Starts the analytics consumer-group worker and performs pending-entry reclamation.
   */
  async startWorker(): Promise<void> {
    if (this.workerRunning) return;
    this.workerRunning = true;
    await this.redis.call('XGROUP', 'CREATE', STREAM_KEY, GROUP, '0', 'MKSTREAM').catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('BUSYGROUP')) return undefined;
      throw error;
    });
    await this.reclaimPending();
    void this.runLoop();
  }

  /**
   * Stops the worker and waits for any in-flight persistence operation to finish.
   */
  async stopWorker(): Promise<void> {
    this.workerRunning = false;
    if (this.inflight) {
      await this.inflight.catch(() => undefined);
    }
  }

  /**
   * Reclaims and reprocesses pending entries that were previously delivered but not acknowledged.
   */
  private async reclaimPending(): Promise<void> {
    let startId = '0-0';
    while (this.workerRunning) {
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
      if (!entries || entries.length === 0) {
        return;
      }
      this.inflight = this.persistBatch(entries);
      await this.inflight;
      this.inflight = null;
      startId = nextStartId;
    }
  }

  /**
   * Worker loop that reads newly-delivered stream entries for this consumer.
   */
  private async runLoop(): Promise<void> {
    while (this.workerRunning) {
      try {
        const rows = await this.redis.call('XREADGROUP', 'GROUP', GROUP, CONSUMER, 'COUNT', String(env.ANALYTICS_BATCH_SIZE), 'BLOCK', '2000', 'STREAMS', STREAM_KEY, '>') as unknown[];
        if (!rows?.length) continue;
        const entries = (rows[0] as [string, Array<[string, string[]]>])[1];
        this.inflight = this.persistBatch(entries);
        await this.inflight;
        this.inflight = null;
        this.consecutiveFailures = 0;
      } catch (error) {
        logger.warn('Analytics worker loop failure', { error: error instanceof Error ? error.message : 'unknown', consecutiveFailures: this.consecutiveFailures + 1 });
        this.consecutiveFailures += 1;
        const delayMs = Math.min(250 * (2 ** this.consecutiveFailures), 10000);
        await this.sleep(delayMs);
        await this.reclaimPending();
      }
    }
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
      const base = i * 8;
      values.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},NULLIF($${base + 5},'')::uuid,NULLIF($${base + 6},'')::uuid,$${base + 7},$${base + 8})`);
      params.push(map.endpoint, map.method, Number.parseInt(map.status_code ?? '0', 10), Number.parseFloat(map.latency_ms ?? '0'), map.user_id ?? '', map.organization_id ?? '', map.captured_at, id);
      ackIds.push(id);
    });
    await query(`INSERT INTO api_request_metrics (endpoint, method, status_code, latency_ms, user_id, organization_id, created_at, redis_entry_id) VALUES ${values.join(',')} ON CONFLICT (redis_entry_id) DO NOTHING`, params);
    await this.redis.call('XACK', STREAM_KEY, GROUP, ...ackIds);
  }

  /**
   * Archives and removes metrics older than 90 days.
   */
  async enforceRetention(organizationId?: string): Promise<void> {
    if (this.retentionRunning) {
      return;
    }
    this.retentionRunning = true;
    try {
      if (!organizationId) {
        const orgRows = await query<{ organization_id: string }>('SELECT DISTINCT organization_id FROM api_request_metrics WHERE organization_id IS NOT NULL');
        for (const row of orgRows) {
          await this.enforceRetention(row.organization_id);
        }
        return;
      }

      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [organizationId]);
        await client.query("SELECT ensure_api_metrics_archive_partition(date_trunc('month', NOW() - INTERVAL '90 days')::date)");
        await client.query("INSERT INTO api_request_metrics_archive SELECT * FROM api_request_metrics WHERE organization_id = $1 AND created_at < NOW() - INTERVAL '90 days' ON CONFLICT (redis_entry_id, created_at) DO NOTHING", [organizationId]);
        await client.query("DELETE FROM api_request_metrics WHERE organization_id = $1 AND created_at < NOW() - INTERVAL '90 days'", [organizationId]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } finally {
      this.retentionRunning = false;
    }
  }


  /**
   * Returns aggregate admin analytics for a given time window.
   */
  async getAdminMetrics(windowMinutes = 60, activeWindowMinutes = 5, organizationId?: string) {
    const safeWindowMinutes = Number.isFinite(windowMinutes) ? Math.max(1, Math.floor(windowMinutes)) : 60;
    const safeActiveWindowMinutes = Number.isFinite(activeWindowMinutes) ? Math.max(1, Math.floor(activeWindowMinutes)) : 5;
    const [totalsRow] = await query<{ request_count: string; unique_users: string; average_latency_ms: string }>(`SELECT COUNT(*)::text AS request_count, COUNT(DISTINCT user_id)::text AS unique_users, COALESCE(ROUND(AVG(latency_ms)::numeric, 2), 0)::text AS average_latency_ms FROM api_request_metrics WHERE created_at >= NOW() - ($1::text || ' minutes')::interval AND ($2::uuid IS NULL OR organization_id = $2::uuid)`, [safeWindowMinutes, organizationId ?? null]);
    const [activeUsersRow] = await query<{ active_users: string }>(`SELECT COUNT(DISTINCT user_id)::text AS active_users FROM api_request_metrics WHERE user_id IS NOT NULL AND created_at >= NOW() - ($1::text || ' minutes')::interval AND ($2::uuid IS NULL OR organization_id = $2::uuid)`, [safeActiveWindowMinutes, organizationId ?? null]);
    const endpointRows = await query<{ endpoint: string; request_count: string; average_latency_ms: string; p95_latency_ms: string; error_rate_percent: string }>(`SELECT endpoint, COUNT(*)::text AS request_count, COALESCE(ROUND(AVG(latency_ms)::numeric, 2), 0)::text AS average_latency_ms, COALESCE(ROUND((percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms))::numeric, 2), 0)::text AS p95_latency_ms, COALESCE(ROUND((SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0)) * 100, 2), 0)::text AS error_rate_percent FROM api_request_metrics WHERE created_at >= NOW() - ($1::text || ' minutes')::interval AND ($2::uuid IS NULL OR organization_id = $2::uuid) GROUP BY endpoint ORDER BY COUNT(*) DESC, endpoint ASC`, [safeWindowMinutes, organizationId ?? null]);
    return { generatedAt: new Date().toISOString(), windowMinutes: safeWindowMinutes, activeWindowMinutes: safeActiveWindowMinutes, totals: { requestCount: Number.parseInt(totalsRow?.request_count ?? '0', 10), uniqueUsers: Number.parseInt(totalsRow?.unique_users ?? '0', 10), activeUsers: Number.parseInt(activeUsersRow?.active_users ?? '0', 10), averageLatencyMs: Number.parseFloat(totalsRow?.average_latency_ms ?? '0') }, endpointUsage: endpointRows.map((row) => ({ endpoint: row.endpoint, requestCount: Number.parseInt(row.request_count, 10), averageLatencyMs: Number.parseFloat(row.average_latency_ms), p95LatencyMs: Number.parseFloat(row.p95_latency_ms), errorRatePercent: Number.parseFloat(row.error_rate_percent) })) };
  }

}

export const analyticsService = new AnalyticsService();
