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
}

export interface InsightsResponse {
  health_score: number;
  risk_level: RiskLevel;
  insights: string[];
}

const LOOKBACK_MONTHS = 12;

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

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  const squaredDiffSum = values.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  return Math.sqrt(squaredDiffSum / values.length);
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
         runway_months
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
          'No financial history is available yet; ingest revenue, expense, and cash reserve records to generate insights.',
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
      const previousMonthLabel = monthLabel(previous.month_start);

      if (previousRevenue > 0) {
        const revenueGrowthPct = ((latestRevenue - previousRevenue) / previousRevenue) * 100;
        const direction = revenueGrowthPct >= 0 ? 'increased' : 'decreased';

        insights.push(
          `Revenue ${direction} ${formatPct(revenueGrowthPct)} in ${latestMonthLabel} compared to ${previousMonthLabel}.`,
        );

        if (revenueGrowthPct < -12) {
          riskPoints += 3;
        } else if (revenueGrowthPct < -5) {
          riskPoints += 2;
        } else if (revenueGrowthPct < 0) {
          riskPoints += 1;
        }
      }
    } else {
      insights.push(`Only one month of financial data (${latestMonthLabel}) is available, so trend confidence is limited.`);
    }

    const expenseRatios = ordered
      .filter((row) => toNumber(row.total_revenue) > 0)
      .map((row) => toNumber(row.total_expenses) / toNumber(row.total_revenue));

    const latestExpenseRatio = latestRevenue > 0 ? latestExpenses / latestRevenue : 0;
    const historicalExpenseRatios = expenseRatios.slice(0, -1);

    if (historicalExpenseRatios.length >= 3) {
      const ratioMean = average(historicalExpenseRatios);
      const ratioStdDev = standardDeviation(historicalExpenseRatios);
      const zScore = ratioStdDev > 0 ? (latestExpenseRatio - ratioMean) / ratioStdDev : 0;

      if (zScore >= 2) {
        insights.push(
          `Expense anomaly detected in ${latestMonthLabel}: expense ratio reached ${(latestExpenseRatio * 100).toFixed(1)}%, well above the ${(ratioMean * 100).toFixed(1)}% historical baseline.`,
        );
        riskPoints += 3;
      } else if (zScore >= 1.2) {
        insights.push(
          `Potential expense anomaly in ${latestMonthLabel}: expense ratio is ${(latestExpenseRatio * 100).toFixed(1)}% vs ${(ratioMean * 100).toFixed(1)}% historical average.`,
        );
        riskPoints += 1;
      } else {
        insights.push(
          `Expense ratio is stable at ${(latestExpenseRatio * 100).toFixed(1)}%, close to the ${(ratioMean * 100).toFixed(1)}% historical average.`,
        );
      }
    } else {
      insights.push(
        `Expense ratio is ${(latestExpenseRatio * 100).toFixed(1)}%; more history is required for statistical anomaly detection.`,
      );
    }

    if (latestNetIncome < 0) {
      insights.push(`Negative cash flow warning: net cash flow was ${latestNetIncome.toFixed(2)} in ${latestMonthLabel}.`);
      riskPoints += 2;
    } else {
      insights.push(`Net cash flow is positive in ${latestMonthLabel} at ${latestNetIncome.toFixed(2)}.`);
    }

    const latestThreeMonths = ordered.slice(-3);
    const negativeCashFlowCount = latestThreeMonths.filter((row) => toNumber(row.net_income) < 0).length;

    if (negativeCashFlowCount >= 2) {
      insights.push('Negative cash flow occurred in at least 2 of the last 3 months, signaling sustained burn risk.');
      riskPoints += 2;
    }

    if (latestBurnRate > 0 && latestRunwayMonths > 0) {
      if (latestRunwayMonths < 3) {
        insights.push(`Critical liquidity warning: cash runway is ${latestRunwayMonths.toFixed(1)} months.`);
        riskPoints += 3;
      } else if (latestRunwayMonths < 6) {
        insights.push(`Liquidity warning: cash runway is ${latestRunwayMonths.toFixed(1)} months.`);
        riskPoints += 2;
      } else if (latestRunwayMonths < 9) {
        insights.push(`Cash runway is ${latestRunwayMonths.toFixed(1)} months; monitor expenses and collections closely.`);
        riskPoints += 1;
      }
    }

    let riskLevel: RiskLevel = 'low';
    if (riskPoints >= 7) {
      riskLevel = 'high';
    } else if (riskPoints >= 3) {
      riskLevel = 'medium';
    }

    const healthScore = Math.round(clamp(100 - riskPoints * 9, 0, 100));

    return {
      health_score: healthScore,
      risk_level: riskLevel,
      insights,
    };
  }
}
