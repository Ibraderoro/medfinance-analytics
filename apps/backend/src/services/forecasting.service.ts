import { query } from '../config/database';
import {
  buildForecastSeries,
  ForecastMetric,
  getMonthStart,
  addMonths,
  formatMonth,
} from './forecasting/forecastingMath';

interface ForecastOptions {
  months: number;
  metric: ForecastMetric;
}

interface BudgetVarianceOptions {
  year: number;
}

interface MonthlyFinancialRow {
  month: string | Date;
  revenue: string;
  expense: string;
}

interface MonthlyPoint {
  month: string;
  revenue: number;
  expense: number;
  net_income: number;
}

const HISTORY_MONTHS = 24;

function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeMonthValue(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  const asDate = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isNaN(asDate.getTime())) {
    return asDate.toISOString().slice(0, 10);
  }

  return String(value).slice(0, 10);
}

export class ForecastingService {
  private async getMonthlyFinancialSeries(): Promise<MonthlyPoint[]> {
    const currentMonth = getMonthStart(new Date());
    const startMonth = addMonths(currentMonth, -(HISTORY_MONTHS - 1));

    const rows = await query<MonthlyFinancialRow>(
      `WITH month_series AS (
         SELECT generate_series($1::date, $2::date, interval '1 month')::date AS month
       ),
       monthly_totals AS (
         SELECT
           DATE_TRUNC('month', t.occurred_on)::date AS month,
           SUM(CASE WHEN t.transaction_type = 'revenue' THEN t.amount ELSE 0 END) AS revenue,
           SUM(CASE WHEN t.transaction_type = 'expense' THEN t.amount ELSE 0 END) AS expense
         FROM transactions t
         WHERE t.occurred_on >= $1::date
           AND t.occurred_on < ($2::date + interval '1 month')
         GROUP BY DATE_TRUNC('month', t.occurred_on)::date
       )
       SELECT
         ms.month,
         COALESCE(mt.revenue, 0)::numeric(16,2) AS revenue,
         COALESCE(mt.expense, 0)::numeric(16,2) AS expense
       FROM month_series ms
       LEFT JOIN monthly_totals mt ON mt.month = ms.month
       ORDER BY ms.month ASC`,
      [formatMonth(startMonth), formatMonth(currentMonth)],
    );

    return rows.map((row) => {
      const revenue = toNumber(row.revenue);
      const expense = toNumber(row.expense);
      return {
        month: normalizeMonthValue(row.month),
        revenue,
        expense,
        net_income: revenue - expense,
      };
    });
  }

  async getForecast(opts: ForecastOptions) {
    const monthlySeries = await this.getMonthlyFinancialSeries();

    const months = monthlySeries.map((point) => point.month);
    const revenueSeries = monthlySeries.map((point) => point.revenue);
    const expenseSeries = monthlySeries.map((point) => point.expense);
    const netIncomeSeries = monthlySeries.map((point) => point.net_income);

    const metricForecasts = {
      revenue: buildForecastSeries({
        metric: 'revenue',
        historicalValues: revenueSeries,
        historicalMonths: months,
        forecastMonths: opts.months,
      }),
      expense: buildForecastSeries({
        metric: 'expense',
        historicalValues: expenseSeries,
        historicalMonths: months,
        forecastMonths: opts.months,
      }),
      net_income: buildForecastSeries({
        metric: 'net_income',
        historicalValues: netIncomeSeries,
        historicalMonths: months,
        forecastMonths: opts.months,
      }),
    };

    const selectedMetric = metricForecasts[opts.metric];

    return {
      metric: opts.metric,
      forecastMonths: opts.months,
      trend: selectedMetric.trend,
      confidenceLevel: selectedMetric.confidenceLevel,
      dataPoints: selectedMetric.series.map((point) => ({
        month: point.month,
        metric: opts.metric,
        projected_total: point.forecast,
        actual_total: point.actual,
        confidence_interval: point.confidence_interval,
      })),
      metrics: metricForecasts,
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
