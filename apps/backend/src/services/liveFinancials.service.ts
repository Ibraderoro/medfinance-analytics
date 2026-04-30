import Redis from 'ioredis';
import { Response } from 'express';
import { query } from '../config/database';
import { CACHE_TTL, getRedis, invalidateFinancialCache } from '../config/redis';
import { CacheService } from '../utils/cache';
import { logger } from '../utils/logger';

type FlushableResponse = Response & { flush?: () => void };

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

type LiveEventType = 'transaction-added' | 'forecast-changed';

interface LiveBroadcastEvent {
  type: LiveEventType;
  organization_id: string;
  updatedAt: string;
}

const FINANCIALS_SUMMARY_CACHE_TTL_SECONDS = CACHE_TTL?.latestMetricsSeconds ?? 120;
const LIVE_EVENT_CHANNEL = 'medfinance:financials:live-events';

function tenantRedisKey(organizationId: string): string {
  return `medfinance:financials:latest_metrics:${organizationId}`;
}

function eventKey(type: LiveEventType, organizationId: string): string {
  return `${type}:${organizationId}`;
}

export class LiveFinancialsService {
  private readonly clients = new Map<Response, string>();

  private readonly cache = new CacheService(
    'financials',
    FINANCIALS_SUMMARY_CACHE_TTL_SECONDS,
  );

  private subscriber: Redis | null = null;

  private readonly inFlightRefreshes = new Map<string, Promise<void>>();

  async start(): Promise<void> {
    if (this.subscriber) {
      return;
    }

    this.subscriber = getRedis().duplicate();
    await this.subscriber.subscribe(LIVE_EVENT_CHANNEL);

    this.subscriber.on('message', (channel, message) => {
      if (channel !== LIVE_EVENT_CHANNEL) {
        return;
      }

      void this.handlePubSubEvent(message);
    });

    logger.info(`Live financial pub/sub started (${LIVE_EVENT_CHANNEL})`);
  }

  async stop(): Promise<void> {
    if (!this.subscriber) {
      return;
    }

    await this.subscriber.unsubscribe(LIVE_EVENT_CHANNEL);
    this.subscriber.disconnect();
    this.subscriber = null;
    logger.info('Live financial pub/sub stopped');
  }

  async addClient(res: Response, organizationId: string): Promise<void> {
    this.clients.set(res, organizationId);
    const latestMetrics = await this.getLatestMetrics(organizationId);

    if (latestMetrics) {
      this.writeSseEvent(res, 'snapshot', latestMetrics);
    } else {
      const payload = await this.buildPayload(organizationId);
      await this.persistPayload(payload);
      this.writeSseEvent(res, 'snapshot', payload);
    }

    logger.info(`Live stream subscriber connected (${this.clients.size} active)`);
  }

  removeClient(res: Response): void {
    this.clients.delete(res);
    logger.info(
      `Live stream subscriber disconnected (${this.clients.size} active)`,
    );
  }

  async publishTransactionAdded(organizationId: string): Promise<void> {
    await this.publishEvent('transaction-added', organizationId);
  }

  async publishForecastChanged(organizationId: string): Promise<void> {
    await this.publishEvent('forecast-changed', organizationId);
  }

  private async publishEvent(type: LiveEventType, organizationId: string): Promise<void> {
    const event: LiveBroadcastEvent = {
      type,
      organization_id: organizationId,
      updatedAt: new Date().toISOString(),
    };

    await invalidateFinancialCache(organizationId);
    await getRedis().publish(LIVE_EVENT_CHANNEL, JSON.stringify(event));
  }

  private async handlePubSubEvent(rawMessage: string): Promise<void> {
    try {
      const event = JSON.parse(rawMessage) as LiveBroadcastEvent;
      if (!event?.organization_id || !event?.type) {
        return;
      }

      await this.refreshAndBroadcast(event);
    } catch (error) {
      logger.warn('Invalid live financial pub/sub event:', error);
    }
  }

  private async refreshAndBroadcast(event: LiveBroadcastEvent): Promise<void> {
    const eventLock = eventKey(event.type, event.organization_id);
    const existingRefresh = this.inFlightRefreshes.get(eventLock);
    if (existingRefresh) {
      await existingRefresh;
      return;
    }

    const refreshTask = (async () => {
      const payload = await this.buildPayload(event.organization_id);
      await this.persistPayload(payload);
      this.broadcast(event.type, payload);
    })();

    this.inFlightRefreshes.set(eventLock, refreshTask);

    try {
      await refreshTask;
    } finally {
      this.inFlightRefreshes.delete(eventLock);
    }
  }

  private async persistPayload(payload: LiveMetricsPayload): Promise<void> {
    await this.cache.set(`summary:${payload.organization_id}:${payload.year}`, payload.summary);
    await getRedis().set(
      tenantRedisKey(payload.organization_id),
      JSON.stringify(payload),
      'EX',
      FINANCIALS_SUMMARY_CACHE_TTL_SECONDS,
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

  private broadcast(eventType: LiveEventType, payload: LiveMetricsPayload): void {
    if (this.clients.size === 0) {
      return;
    }

    for (const [client, organizationId] of this.clients.entries()) {
      if (organizationId === payload.organization_id) {
        this.writeSseEvent(client, eventType, payload);
      }
    }
  }

  private writeSseEvent(
    res: Response,
    event: LiveEventType | 'snapshot',
    payload: LiveMetricsPayload,
  ): void {
    const sseResponse = res as FlushableResponse;
    sseResponse.write(`event: ${event}\n`);
    sseResponse.flush?.();
    sseResponse.write(`data: ${JSON.stringify(payload)}\n\n`);
    sseResponse.flush?.();
  }
}

export const liveFinancialsService = new LiveFinancialsService();
