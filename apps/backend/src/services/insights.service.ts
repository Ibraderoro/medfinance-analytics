import { query } from '../config/database';

type RiskLevel = 'low' | 'medium' | 'high';

interface KpiRow {
  month_start: string;
  total_revenue: string;
  total_expenses: string;
  net_income: string;
  burn_rate: string;
  cash_reserve_amount: string;
  runway_months: string;
  revenue_mom_growth: string;
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

function formatPct(value: number): string {
  return `${Math.abs(value).toFixed(1)}%`;
}

function monthLabel(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export class InsightsService {
  async getInsights(organizationId: string): Promise<InsightsResponse> {
    const rows = await query<KpiRow>(
      `SELECT
         month_start,
         total_revenue,
         total_expenses,
         net_income,
         burn_rate,
         cash_reserve_amount,
         runway_months,
         revenue_mom_growth
       FROM financial_kpis
       WHERE organization_id = $1
       ORDER BY month_start DESC
       LIMIT $2`,
      [organizationId, LOOKBACK_MONTHS],
    );

    if (rows.length === 0) {
      return {
        health_score: 0,
        risk_level: 'high',
        insights: [
          'No KPI history is available yet; ingest monthly transactions and cash reserve balances to generate reliable insights.',
        ],
      };
    }

    const ordered = [...rows].reverse();
    const latest = ordered[ordered.length - 1];
    const previous = ordered.length > 1 ? ordered[ordered.length - 2] : null;

    const latestRevenue = toNumber(latest.total_revenue);
    const latestExpenses = toNumber(latest.total_expenses);
    const latestNetIncome = toNumber(latest.net_income);
    const latestRunwayMonths = toNumber(latest.runway_months);
    const latestBurnRate = toNumber(latest.burn_rate);
    const latestMonthLabel = monthLabel(latest.month_start);

    const insights: string[] = [];
    let riskPoints = 0;

    if (previous) {
      const previousRevenue = toNumber(previous.total_revenue);
      const previousExpenses = toNumber(previous.total_expenses);

      if (previousRevenue > 0) {
        const revenueGrowthPct = ((latestRevenue - previousRevenue) / previousRevenue) * 100;
        const direction = revenueGrowthPct >= 0 ? 'increased' : 'decreased';
        insights.push(
          `Revenue ${direction} ${formatPct(revenueGrowthPct)} in ${latestMonthLabel} compared to ${monthLabel(previous.month_start)}.`,
        );

        if (revenueGrowthPct < -8) {
          riskPoints += 2;
        } else if (revenueGrowthPct < 0) {
          riskPoints += 1;
        }
      }

      if (previousExpenses > 0 && previousRevenue > 0) {
        const expenseGrowthPct = ((latestExpenses - previousExpenses) / previousExpenses) * 100;
        const revenueGrowthPct = ((latestRevenue - previousRevenue) / previousRevenue) * 100;

        if (expenseGrowthPct > revenueGrowthPct) {
          insights.push(
            `Expenses are growing faster than revenue (${formatPct(expenseGrowthPct)} vs ${formatPct(revenueGrowthPct)} month-over-month).`,
          );

          const growthGap = expenseGrowthPct - revenueGrowthPct;
          if (growthGap >= 8) {
            riskPoints += 2;
          } else if (growthGap > 0) {
            riskPoints += 1;
          }
        } else {
          insights.push(
            `Revenue growth is outpacing expense growth (${formatPct(revenueGrowthPct)} vs ${formatPct(expenseGrowthPct)} month-over-month).`,
          );
        }
      }
    } else {
      insights.push(`Only one month of KPI data (${latestMonthLabel}) is available, so trend-based insights are limited.`);
    }

    if (latestBurnRate > 0 && latestRunwayMonths > 0) {
      if (latestRunwayMonths < 6) {
        insights.push(`Cash runway is ${latestRunwayMonths.toFixed(1)} months (high risk, below the 6-month threshold).`);
        riskPoints += 3;
      } else if (latestRunwayMonths < 9) {
        insights.push(`Cash runway is ${latestRunwayMonths.toFixed(1)} months (medium risk, monitor burn rate closely).`);
        riskPoints += 1;
      } else {
        insights.push(`Cash runway is ${latestRunwayMonths.toFixed(1)} months, which is above the 9-month safety threshold.`);
      }
    } else if (latestBurnRate <= 0) {
      insights.push('Burn rate is zero this month, so runway is not currently constrained by net cash burn.');
    } else {
      insights.push('Cash runway could not be calculated due to missing cash reserve data.');
      riskPoints += 1;
    }

    const netMargin = latestRevenue > 0 ? (latestNetIncome / latestRevenue) * 100 : 0;
    if (latestNetIncome < 0) {
      insights.push(`Net income is negative in ${latestMonthLabel} (${netMargin.toFixed(1)}% margin), indicating ongoing burn.`);
      riskPoints += 2;
    } else {
      insights.push(`Net income is positive in ${latestMonthLabel} (${netMargin.toFixed(1)}% margin).`);
    }

    const threeMonthLossCount = ordered
      .slice(-3)
      .filter((row) => toNumber(row.net_income) < 0).length;

    if (threeMonthLossCount >= 2) {
      insights.push('The company reported losses in at least 2 of the last 3 months, increasing near-term risk.');
      riskPoints += 2;
    }

    let riskLevel: RiskLevel = 'low';
    if (riskPoints >= 5) {
      riskLevel = 'high';
    } else if (riskPoints >= 2) {
      riskLevel = 'medium';
    }

    const healthScore = Math.round(clamp(100 - riskPoints * 12, 0, 100));

    return {
      health_score: healthScore,
      risk_level: riskLevel,
      insights,
    };
  }
}
