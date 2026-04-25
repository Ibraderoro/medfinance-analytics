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
    const rows = await query<Record<string, unknown>>(
      `SELECT
         MAKE_DATE(f.fiscal_year, f.fiscal_month, 1) AS month,
         f.metric_type AS metric,
         SUM(f.projected_amount) AS projected_total,
         COALESCE(SUM(t.amount), 0) AS actual_total
       FROM forecasts f
       LEFT JOIN transactions t
         ON t.forecast_id = f.id
       WHERE f.metric_type = $1
         AND MAKE_DATE(f.fiscal_year, f.fiscal_month, 1) >= DATE_TRUNC('month', NOW()) - INTERVAL '24 months'
       GROUP BY MAKE_DATE(f.fiscal_year, f.fiscal_month, 1), f.metric_type
       ORDER BY month ASC
       LIMIT $2`,
      [opts.metric, opts.months],
    );

    return {
      metric: opts.metric,
      forecastMonths: opts.months,
      dataPoints: rows,
    };
  }

  async getBudgetVariance(opts: BudgetVarianceOptions) {
    const rows = await query<Record<string, unknown>>(
      `SELECT
         d.name AS department,
         f.metric_type,
         SUM(f.projected_amount) AS budgeted_amount,
         COALESCE(SUM(t.amount), 0) AS actual_amount,
         SUM(f.projected_amount) - COALESCE(SUM(t.amount), 0) AS variance
       FROM forecasts f
       INNER JOIN departments d ON d.id = f.department_id
       LEFT JOIN transactions t
         ON t.forecast_id = f.id
        AND EXTRACT(YEAR FROM t.occurred_on) = $1
       WHERE f.fiscal_year = $1
       GROUP BY d.name, f.metric_type
       ORDER BY variance DESC`,
      [opts.year],
    );

    return rows;
  }
}
