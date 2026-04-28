import { query } from '../config/database';

type RiskLevel = 'low' | 'medium' | 'high';

interface KpiRow {
  month_start: string;
  total_revenue: string;
  total_expenses: string;
  net_income: string;
}

interface InsightsResponse {
  health_score: number;
  risk_level: RiskLevel;
  insights: string[];
}

const LOOKBACK_MONTHS = 6;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toNumber(value: string): number {
  return Number.parseFloat(value);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export class InsightsService {
  async getInsights(): Promise<InsightsResponse> {
    const rows = await query<KpiRow>(
      `SELECT
         month_start,
         total_revenue,
         total_expenses,
         net_income
       FROM financial_kpis
       ORDER BY month_start DESC
       LIMIT $1`,
      [LOOKBACK_MONTHS],
    );

    if (rows.length === 0) {
      return {
        health_score: 0,
        risk_level: 'high',
        insights: [
          'No KPI history is available yet; risk is high until monthly revenue and expense data is ingested.',
        ],
      };
    }

    const chronologicallySorted = [...rows].reverse();

    const profitabilityMargins = chronologicallySorted
      .filter((row) => toNumber(row.total_revenue) > 0)
      .map((row) => (toNumber(row.net_income) / toNumber(row.total_revenue)) * 100);

    const expenseRatios = chronologicallySorted
      .filter((row) => toNumber(row.total_revenue) > 0)
      .map((row) => (toNumber(row.total_expenses) / toNumber(row.total_revenue)) * 100);

    const revenueGrowthRates: number[] = [];
    for (let i = 1; i < chronologicallySorted.length; i += 1) {
      const previousRevenue = toNumber(chronologicallySorted[i - 1].total_revenue);
      const currentRevenue = toNumber(chronologicallySorted[i].total_revenue);

      if (previousRevenue > 0) {
        revenueGrowthRates.push(((currentRevenue - previousRevenue) / previousRevenue) * 100);
      }
    }

    const profitability = average(profitabilityMargins);
    const expenseRatio = average(expenseRatios);
    const growthRate = average(revenueGrowthRates);

    // 0..100 component scoring with business-oriented thresholds.
    const profitabilityScore = clamp(((profitability + 10) / 30) * 100, 0, 100);
    const expenseScore = clamp(((100 - expenseRatio) / 50) * 100, 0, 100);
    const growthScore = clamp(((growthRate + 5) / 20) * 100, 0, 100);

    const weightedScore =
      profitabilityScore * 0.45 +
      expenseScore * 0.3 +
      growthScore * 0.25;

    const healthScore = Math.round(clamp(weightedScore, 0, 100));

    const insights: string[] = [
      `Profitability averaged ${profitability.toFixed(1)}% over the last ${chronologicallySorted.length} months, contributing ${Math.round(profitabilityScore)} points in the score model.`,
      `Expense ratio averaged ${expenseRatio.toFixed(1)}% of revenue; lower ratios improve resilience and contributed ${Math.round(expenseScore)} points.`,
      `Revenue growth averaged ${growthRate.toFixed(1)}% month-over-month, contributing ${Math.round(growthScore)} points to forward-looking health.`,
    ];

    const latest = chronologicallySorted[chronologicallySorted.length - 1];
    const latestRevenue = toNumber(latest.total_revenue);
    const latestExpenses = toNumber(latest.total_expenses);
    const latestExpenseRatio = latestRevenue > 0 ? (latestExpenses / latestRevenue) * 100 : 100;

    const hasHighExpenses = latestExpenseRatio >= 75;

    let decliningRevenueStreak = 0;
    for (let i = chronologicallySorted.length - 1; i > 0; i -= 1) {
      const currentRevenue = toNumber(chronologicallySorted[i].total_revenue);
      const previousRevenue = toNumber(chronologicallySorted[i - 1].total_revenue);
      if (currentRevenue < previousRevenue) {
        decliningRevenueStreak += 1;
      } else {
        break;
      }
    }

    const recentNegativeNetIncomeCount = chronologicallySorted
      .slice(-3)
      .filter((row) => toNumber(row.net_income) < 0).length;

    const hasNegativeTrend = decliningRevenueStreak >= 2 || recentNegativeNetIncomeCount >= 2;

    if (hasHighExpenses) {
      insights.push(
        `Risk flag: high expenses detected this month (${latestExpenseRatio.toFixed(1)}% of revenue), which can pressure cash runway if sustained.`,
      );
    }

    if (hasNegativeTrend) {
      insights.push(
        'Risk flag: negative trend detected from consecutive revenue declines or repeated monthly losses in the latest quarter.',
      );
    }

    let riskLevel: RiskLevel = 'low';
    const riskFlags = Number(hasHighExpenses) + Number(hasNegativeTrend);

    if (healthScore < 40 || riskFlags >= 2) {
      riskLevel = 'high';
    } else if (healthScore < 70 || riskFlags === 1) {
      riskLevel = 'medium';
    }

    if (riskLevel === 'low') {
      insights.push('Overall risk remains low: fundamentals are stable across profitability, cost control, and growth.');
    }

    return {
      health_score: healthScore,
      risk_level: riskLevel,
      insights,
    };
  }
}
