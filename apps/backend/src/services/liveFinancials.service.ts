import { Response } from 'express';
import { query } from '../config/database';
import { getRedis } from '../config/redis';
import { CacheService } from '../utils/cache';
import { logger } from '../utils/logger';

interface LiveMetricsPayload {
  organization_id: string;
  year: number;
  summary: {
    total_revenue: number;
    total_expenses: number;
    net_income: number;
  };
  latestKpi: Record<string, unknown> | null;
  updatedAt: string;
}

const FINANCIALS_SUMMARY_CACHE_TTL_SECONDS = 300;
const LIVE_UPDATE_INTERVAL_MS = 10_000;

function tenantRedisKey(organizationId: string): string {
  return `medfinance:financials:latest_metrics:${organizationId}`;
}

export class LiveFinancialsService {
  private readonly clients = new Map<Response, string>();

  private readonly cache = new CacheService(
    'financials',
    FINANCIALS_SUMMARY_CACHE_TTL_SECONDS,
  );

  private ticker: NodeJS.Timeout | null = null;

  async start(): Promise<void> {
    if (this.ticker) {
      return;
    }

    this.ticker = setInterval(() => {
      void this.refreshMetrics();
    }, LIVE_UPDATE_INTERVAL_MS);

    logger.info(
      `Live financial updater started (interval: ${LIVE_UPDATE_INTERVAL_MS}ms)`,
    );
  }

  stop(): void {
    if (!this.ticker) {
      return;
    }

    clearInterval(this.ticker);
    this.ticker = null;
    logger.info('Live financial updater stopped');
  }

  async addClient(res: Response, organizationId: string): Promise<void> {
    this.clients.set(res, organizationId);
    const latestMetrics = await this.getLatestMetrics(organizationId);

    if (latestMetrics) {
      this.writeSseEvent(res, latestMetrics);
    } else {
      const payload = await this.buildPayload(organizationId);
      await this.persistPayload(payload);
      this.writeSseEvent(res, payload);
    }

    logger.info(`Live stream subscriber connected (${this.clients.size} active)`);
  }

  removeClient(res: Response): void {
    this.clients.delete(res);
    logger.info(
      `Live stream subscriber disconnected (${this.clients.size} active)`,
    );
  }

  private async refreshMetrics(): Promise<void> {
    const organizationIds = [...new Set(this.clients.values())];
    if (organizationIds.length === 0) {
      return;
    }

    try {
      const payloads = await Promise.all(organizationIds.map((orgId) => this.buildPayload(orgId)));
      await Promise.all(payloads.map((payload) => this.persistPayload(payload)));
      this.broadcast(payloads);
    } catch (error) {
      logger.warn('Live financial refresh failed:', error);
    }
  }

  private async persistPayload(payload: LiveMetricsPayload): Promise<void> {
    await this.cache.set(`summary:${payload.organization_id}:${payload.year}`, payload.summary);
    await getRedis().set(
      tenantRedisKey(payload.organization_id),
      JSON.stringify(payload),
      'EX',
      Math.ceil(LIVE_UPDATE_INTERVAL_MS / 1000) * 3,
    );
  }

  private async buildPayload(organizationId: string): Promise<LiveMetricsPayload> {
    const year = new Date().getFullYear();

    const summaryRows = await query<{
      total_revenue: string;
      total_expenses: string;
      net_income: string;
    }>(
      `SELECT
         COALESCE(SUM(CASE WHEN transaction_type = 'revenue' THEN amount ELSE 0 END), 0) AS total_revenue,
         COALESCE(SUM(CASE WHEN transaction_type = 'expense' THEN amount ELSE 0 END), 0) AS total_expenses,
         COALESCE(SUM(CASE WHEN transaction_type = 'revenue' THEN amount ELSE -amount END), 0) AS net_income
       FROM transactions
       WHERE organization_id = $1
         AND EXTRACT(YEAR FROM occurred_on) = $2`,
      [organizationId, year],
    );

    const latestKpiRows = await query<Record<string, unknown>>(
      `SELECT *
       FROM financial_kpis
       WHERE organization_id = $1
         AND fiscal_year = $2
       ORDER BY fiscal_month DESC
       LIMIT 1`,
      [organizationId, year],
    );

    const summary = summaryRows[0];

    return {
      organization_id: organizationId,
      year,
      summary: {
        total_revenue: Number(summary?.total_revenue ?? 0),
        total_expenses: Number(summary?.total_expenses ?? 0),
        net_income: Number(summary?.net_income ?? 0),
      },
      latestKpi: latestKpiRows[0] ?? null,
      updatedAt: new Date().toISOString(),
    };
  }

  private async getLatestMetrics(organizationId: string): Promise<LiveMetricsPayload | null> {
    try {
      const cached = await getRedis().get(tenantRedisKey(organizationId));
      return cached ? (JSON.parse(cached) as LiveMetricsPayload) : null;
    } catch (error) {
      logger.warn('Failed to read latest metrics from Redis:', error);
      return null;
    }
  }

  private broadcast(payloads: LiveMetricsPayload[]): void {
    if (this.clients.size === 0) {
      return;
    }

    for (const [client, organizationId] of this.clients.entries()) {
      const payload = payloads.find((item) => item.organization_id === organizationId);
      if (payload) {
        this.writeSseEvent(client, payload);
      }
    }
  }

  private writeSseEvent(res: Response, payload: LiveMetricsPayload): void {
    res.write('event: financial-update\n');
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }
}

export const liveFinancialsService = new LiveFinancialsService();
