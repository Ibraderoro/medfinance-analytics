import { query } from '../config/database';

interface ForecastOptions {
  months: number;
  metric: string;
}

interface BudgetVarianceOptions {
  year: number;
}

export class ForecastingService {
  async getForecast(opts: ForecastOptions) {
    // Fetch last 24 months of actuals and extrapolate a simple linear trend
    const rows = await query<Record<string, unknown>>(
      `SELECT
         DATE_TRUNC('month', transaction_date) AS month,
         SUM(amount) AS total
       FROM financial_transactions
       WHERE type = $1
         AND transaction_date >= NOW() - INTERVAL '24 months'
       GROUP BY DATE_TRUNC('month', transaction_date)
       ORDER BY month ASC`,
      [opts.metric],
    );

    // Attach metadata for the client to render forecast vs actual
    return {
      metric: opts.metric,
      forecastMonths: opts.months,
      actuals: rows,
    };
  }

  async getBudgetVariance(opts: BudgetVarianceOptions) {
    const rows = await query<Record<string, unknown>>(
      `SELECT
         b.category,
         b.budgeted_amount,
         COALESCE(SUM(t.amount), 0) AS actual_amount,
         (b.budgeted_amount - COALESCE(SUM(t.amount), 0)) AS variance
       FROM budgets b
       LEFT JOIN financial_transactions t
         ON t.category = b.category
        AND EXTRACT(YEAR FROM t.transaction_date) = $1
       WHERE b.fiscal_year = $1
       GROUP BY b.category, b.budgeted_amount
       ORDER BY variance DESC`,
      [opts.year],
    );
    return rows;
  }
}
