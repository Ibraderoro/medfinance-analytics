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
  async getSummary(opts: SummaryOptions) {
    const cacheKey = `summary:${opts.period}:${opts.year}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    const rows = await query<Record<string, unknown>>(
      `SELECT
         SUM(CASE WHEN type = 'revenue' THEN amount ELSE 0 END) AS total_revenue,
         SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) AS total_expenses,
         SUM(CASE WHEN type = 'revenue' THEN amount ELSE -amount END) AS net_income
       FROM financial_transactions
       WHERE EXTRACT(YEAR FROM transaction_date) = $1`,
      [opts.year],
    );

    const result = rows[0] ?? {};
    await cache.set(cacheKey, result);
    return result;
  }

  async getRevenue(opts: DateRangeOptions) {
    const rows = await query<Record<string, unknown>>(
      `SELECT
         DATE_TRUNC('month', transaction_date) AS month,
         SUM(amount) AS total
       FROM financial_transactions
       WHERE type = 'revenue'
         AND ($1::date IS NULL OR transaction_date >= $1::date)
         AND ($2::date IS NULL OR transaction_date <= $2::date)
       GROUP BY DATE_TRUNC('month', transaction_date)
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
         DATE_TRUNC('month', transaction_date) AS month
       FROM financial_transactions
       WHERE type = 'expense'
         AND ($1::date IS NULL OR transaction_date >= $1::date)
         AND ($2::date IS NULL OR transaction_date <= $2::date)
       GROUP BY category, DATE_TRUNC('month', transaction_date)
       ORDER BY month ASC, total DESC`,
      [opts.startDate ?? null, opts.endDate ?? null],
    );
    return rows;
  }

  async getCashFlow(opts: DateRangeOptions) {
    const rows = await query<Record<string, unknown>>(
      `SELECT
         DATE_TRUNC('month', transaction_date) AS month,
         SUM(CASE WHEN type = 'revenue' THEN amount ELSE -amount END) AS net_cash_flow
       FROM financial_transactions
       WHERE ($1::date IS NULL OR transaction_date >= $1::date)
         AND ($2::date IS NULL OR transaction_date <= $2::date)
       GROUP BY DATE_TRUNC('month', transaction_date)
       ORDER BY month ASC`,
      [opts.startDate ?? null, opts.endDate ?? null],
    );
    return rows;
  }
}
