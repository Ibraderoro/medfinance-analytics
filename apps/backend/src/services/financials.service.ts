import { query } from '../config/database';
import { CACHE_TTL, invalidateFinancialCache } from '../config/redis';
import { CacheService } from '../utils/cache';

interface TenantYearOptions {
  year: number;
  organizationId: string;
}

interface SummaryOptions extends TenantYearOptions {
  period: string;
}

interface DateRangeOptions {
  startDate?: string;
  endDate?: string;
  organizationId: string;
}

const cache = new CacheService('financials', CACHE_TTL?.financialDataSeconds ?? 300);

type SpanLike = {
  setAttribute: (k: string, v: unknown) => void;
  recordException: (e: Error) => void;
  setStatus: (status: { code: number }) => void;
  end: () => void;
};

const NOOP_SPAN: SpanLike = {
  setAttribute: () => undefined,
  recordException: () => undefined,
  setStatus: () => undefined,
  end: () => undefined,
};

function getTelemetry(): { tracer: { startActiveSpan: <T>(name: string, fn: (span: SpanLike) => Promise<T>) => Promise<T> }; errorCode: number } {
  const otel = (globalThis as { __otelApi?: { trace?: { getTracer: (name: string) => { startActiveSpan: <T>(n: string, fn: (s: SpanLike) => Promise<T>) => Promise<T> } }; SpanStatusCode?: { ERROR?: number } } }).__otelApi;
  const tracer = otel?.trace?.getTracer('medfinance-backend.financials-service');
  return {
    tracer: tracer ?? { startActiveSpan: async (_name, fn) => fn(NOOP_SPAN) },
    errorCode: otel?.SpanStatusCode?.ERROR ?? 2,
  };
}

export class FinancialsService {
  private telemetry = getTelemetry();

  private async runTracedQuery<T extends Record<string, unknown>>(spanName: string, sql: string, params: unknown[]): Promise<T[]> {
    return this.telemetry.tracer.startActiveSpan(spanName, async (span: SpanLike) => {
      try {
        span.setAttribute('db.system', 'postgresql');
        span.setAttribute('db.operation', 'SELECT');
        span.setAttribute('db.sql.table', 'transactions');
        const result = await query<T>(sql, params);
        span.setAttribute('db.response.row_count', result.length);
        return result;
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({ code: this.telemetry.errorCode });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  private async withCacheInvalidation<T>(organizationId: string, operation: () => Promise<T>): Promise<T> {
    const result = await operation();
    await invalidateOrganizationFinancialCache(organizationId);
    return result;
  }

  async getKpis(opts: TenantYearOptions) {
    const cacheKey = `kpis:${opts.organizationId}:${opts.year}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    const rows = await this.runTracedQuery<Record<string, unknown>>(
      'financials.get_kpis.query',
      `SELECT *
       FROM financial_kpis
       WHERE organization_id = $1
         AND fiscal_year = $2
       ORDER BY fiscal_month ASC`,
      [opts.organizationId, opts.year],
    );

    await cache.set(cacheKey, rows);
    return rows;
  }

  async getSummary(opts: SummaryOptions) {
    const cacheKey = `summary:${opts.organizationId}:${opts.year}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    const rows = await this.runTracedQuery<Record<string, unknown>>(
      'financials.get_summary.query',
      `SELECT
         COALESCE(SUM(CASE WHEN transaction_type = 'revenue' THEN amount ELSE 0 END), 0) AS total_revenue,
         COALESCE(SUM(CASE WHEN transaction_type = 'expense' THEN amount ELSE 0 END), 0) AS total_expenses,
         COALESCE(SUM(CASE WHEN transaction_type = 'revenue' THEN amount ELSE -amount END), 0) AS net_income
       FROM transactions
       WHERE organization_id = $1
         AND EXTRACT(YEAR FROM occurred_on) = $2`,
      [opts.organizationId, opts.year],
    );

    const result = rows[0] ?? {};
    await cache.set(cacheKey, result);
    return result;
  }

  async getRevenue(opts: DateRangeOptions) {
    return query<Record<string, unknown>>(
      `SELECT
         DATE_TRUNC('month', occurred_on) AS month,
         SUM(amount) AS total
       FROM transactions
       WHERE organization_id = $1
         AND transaction_type = 'revenue'
         AND ($2::date IS NULL OR occurred_on >= $2::date)
         AND ($3::date IS NULL OR occurred_on <= $3::date)
       GROUP BY DATE_TRUNC('month', occurred_on)
       ORDER BY month ASC`,
      [opts.organizationId, opts.startDate ?? null, opts.endDate ?? null],
    );
  }

  async getExpenses(opts: DateRangeOptions) {
    return query<Record<string, unknown>>(
      `SELECT
         category,
         SUM(amount) AS total,
         DATE_TRUNC('month', occurred_on) AS month
       FROM transactions
       WHERE organization_id = $1
         AND transaction_type = 'expense'
         AND ($2::date IS NULL OR occurred_on >= $2::date)
         AND ($3::date IS NULL OR occurred_on <= $3::date)
       GROUP BY category, DATE_TRUNC('month', occurred_on)
       ORDER BY month ASC, total DESC`,
      [opts.organizationId, opts.startDate ?? null, opts.endDate ?? null],
    );
  }

  async getCashFlow(opts: DateRangeOptions) {
    return query<Record<string, unknown>>(
      `SELECT
         DATE_TRUNC('month', occurred_on) AS month,
         SUM(CASE WHEN transaction_type = 'revenue' THEN amount ELSE -amount END) AS net_cash_flow
       FROM transactions
       WHERE organization_id = $1
         AND ($2::date IS NULL OR occurred_on >= $2::date)
         AND ($3::date IS NULL OR occurred_on <= $3::date)
       GROUP BY DATE_TRUNC('month', occurred_on)
       ORDER BY month ASC`,
      [opts.organizationId, opts.startDate ?? null, opts.endDate ?? null],
    );
  }
}


export async function invalidateOrganizationFinancialCache(organizationId: string): Promise<void> {
  await invalidateFinancialCache(organizationId);
}
