import { query } from '../config/database';
import { CacheService } from '../utils/cache';

interface SummaryOptions {
  period: string;
  year: number;
}

interface DateRangeOptions {
  startDate?: string;
  endDate?: string;
}

const cache = new CacheService('financials', 300);

export class FinancialsService {
  async getKpis(opts: { year: number }) {
    const cacheKey = `kpis:${opts.year}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    const rows = await query<Record<string, unknown>>(
      `SELECT *
       FROM financial_kpis
       WHERE fiscal_year = $1
       ORDER BY fiscal_month ASC`,
      [opts.year],
    );

    await cache.set(cacheKey, rows);
    return rows;
  }

  async getSummary(opts: SummaryOptions) {
    const cacheKey = `summary:${opts.year}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    const rows = await query<Record<string, unknown>>(
      `SELECT
         COALESCE(SUM(CASE WHEN transaction_type = 'revenue' THEN amount ELSE 0 END), 0) AS total_revenue,
         COALESCE(SUM(CASE WHEN transaction_type = 'expense' THEN amount ELSE 0 END), 0) AS total_expenses,
         COALESCE(SUM(CASE WHEN transaction_type = 'revenue' THEN amount ELSE -amount END), 0) AS net_income
       FROM transactions
       WHERE EXTRACT(YEAR FROM occurred_on) = $1`,
      [opts.year],
    );

    const result = rows[0] ?? {};
    await cache.set(cacheKey, result);
    return result;
  }

  async getRevenue(opts: DateRangeOptions) {
    const rows = await query<Record<string, unknown>>(
      `SELECT
         DATE_TRUNC('month', occurred_on) AS month,
         SUM(amount) AS total
       FROM transactions
       WHERE transaction_type = 'revenue'
         AND ($1::date IS NULL OR occurred_on >= $1::date)
         AND ($2::date IS NULL OR occurred_on <= $2::date)
       GROUP BY DATE_TRUNC('month', occurred_on)
       ORDER BY month ASC`,
      [opts.startDate ?? null, opts.endDate ?? null],
    );
    return rows;
  }

  async getExpenses(opts: DateRangeOptions) {
    const rows = await query<Record<string, unknown>>(
      `SELECT
         category,
         SUM(amount) AS total,
         DATE_TRUNC('month', occurred_on) AS month
       FROM transactions
       WHERE transaction_type = 'expense'
         AND ($1::date IS NULL OR occurred_on >= $1::date)
         AND ($2::date IS NULL OR occurred_on <= $2::date)
       GROUP BY category, DATE_TRUNC('month', occurred_on)
       ORDER BY month ASC, total DESC`,
      [opts.startDate ?? null, opts.endDate ?? null],
    );
    return rows;
  }

  async getCashFlow(opts: DateRangeOptions) {
    const rows = await query<Record<string, unknown>>(
      `SELECT
         DATE_TRUNC('month', occurred_on) AS month,
         SUM(CASE WHEN transaction_type = 'revenue' THEN amount ELSE -amount END) AS net_cash_flow
       FROM transactions
       WHERE ($1::date IS NULL OR occurred_on >= $1::date)
         AND ($2::date IS NULL OR occurred_on <= $2::date)
       GROUP BY DATE_TRUNC('month', occurred_on)
       ORDER BY month ASC`,
      [opts.startDate ?? null, opts.endDate ?? null],
    );
    return rows;
  }
}
