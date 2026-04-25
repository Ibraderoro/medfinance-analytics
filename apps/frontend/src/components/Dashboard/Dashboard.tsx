import { Card } from '../common/Card';
import { RevenueChart } from '../Charts/RevenueChart';
import { ForecastChart } from '../Charts/ForecastChart';
import { ComplianceChart } from '../Charts/ComplianceChart';
import { useFinancials } from '../../hooks/useFinancials';
import { useForecasting } from '../../hooks/useForecasting';
import { Loading } from '../common/Loading';
import styles from './Dashboard.module.css';

/** Compute a year-over-year percentage change label, e.g. "+8.2%" */
function yoyTrend(current: string | number, previous: string | number): string {
  const curr = Number(current);
  const prev = Number(previous);
  if (!prev) return '—';
  const pct = ((curr - prev) / prev) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

export function Dashboard() {
  const { summary, prevSummary, revenue, isLoading: finLoading } = useFinancials();
  const { forecast, isLoading: forecastLoading } = useForecasting();

  const complianceData = [
    { label: 'Compliant', value: 72, color: '#057a55' },
    { label: 'Review', value: 18, color: '#c27803' },
    { label: 'Non-compliant', value: 10, color: '#c81e1e' },
  ];

  const revenueTrend = summary && prevSummary
    ? yoyTrend(summary.total_revenue, prevSummary.total_revenue)
    : '—';
  const expensesTrend = summary && prevSummary
    ? yoyTrend(summary.total_expenses, prevSummary.total_expenses)
    : '—';
  const netIncomeTrend = summary && prevSummary
    ? yoyTrend(summary.net_income, prevSummary.net_income)
    : '—';

  const revenuePositive = summary && prevSummary
    ? Number(summary.total_revenue) >= Number(prevSummary.total_revenue)
    : true;
  const expensesPositive = summary && prevSummary
    ? Number(summary.total_expenses) <= Number(prevSummary.total_expenses)
    : false;
  const netIncomePositive = summary && prevSummary
    ? Number(summary.net_income) >= Number(prevSummary.net_income)
    : true;

  return (
    <div className={styles.dashboard}>
      <h1 className={styles.title}>Financial Overview</h1>

      {/* KPI strip */}
      <div className={styles.kpiRow}>
        <KpiCard
          label="Total Revenue"
          value={summary ? `$${Number(summary.total_revenue).toLocaleString()}` : '—'}
          trend={revenueTrend}
          positive={revenuePositive}
        />
        <KpiCard
          label="Total Expenses"
          value={summary ? `$${Number(summary.total_expenses).toLocaleString()}` : '—'}
          trend={expensesTrend}
          positive={expensesPositive}
        />
        <KpiCard
          label="Net Income"
          value={summary ? `$${Number(summary.net_income).toLocaleString()}` : '—'}
          trend={netIncomeTrend}
          positive={netIncomePositive}
        />
      </div>

      {/* Charts */}
      <div className={styles.chartsRow}>
        <Card title="Monthly Revenue" className={styles.chartCard}>
          {finLoading ? (
            <Loading />
          ) : (
            <RevenueChart data={revenue} width={560} height={260} />
          )}
        </Card>
        <Card title="Compliance Status" className={styles.complianceCard}>
          <ComplianceChart data={complianceData} width={280} height={260} />
        </Card>
      </div>

      <Card title="Revenue Forecast (12 months)" className={styles.forecastCard}>
        {forecastLoading ? (
          <Loading />
        ) : (
          <ForecastChart data={forecast} width={760} height={260} />
        )}
      </Card>
    </div>
  );
}

interface KpiCardProps {
  label: string;
  value: string;
  trend: string;
  positive: boolean;
}

function KpiCard({ label, value, trend, positive }: KpiCardProps) {
  return (
    <div className={styles.kpiCard}>
      <span className={styles.kpiLabel}>{label}</span>
      <span className={styles.kpiValue}>{value}</span>
      {trend !== '—' && (
        <span className={`${styles.kpiTrend} ${positive ? styles.positive : styles.negative}`}>
          {positive ? '↑' : '↓'} {trend}
        </span>
      )}
    </div>
  );
}
