import { Card } from '../common/Card';
import { RevenueChart } from '../Charts/RevenueChart';
import { ForecastChart } from '../Charts/ForecastChart';
import { ComplianceChart } from '../Charts/ComplianceChart';
import { useFinancials } from '../../hooks/useFinancials';
import { useFinancialKpis } from '../../hooks/useFinancialKpis';
import { useForecasting } from '../../hooks/useForecasting';
import { Loading } from '../common/Loading';
import styles from './Dashboard.module.css';

/** Format a pre-computed growth percentage from the DB, e.g. "+8.20%" */
function formatGrowth(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const num = Number(value);
  if (isNaN(num)) return '—';
  return `${num >= 0 ? '+' : ''}${num.toFixed(1)}%`;
}

export function Dashboard() {
  const { revenue, isLoading: finLoading } = useFinancials();
  const { latest: kpiRow } = useFinancialKpis();
  const { forecast, isLoading: forecastLoading } = useForecasting();

  const complianceData = [
    { label: 'Compliant', value: 72, color: '#057a55' },
    { label: 'Review', value: 18, color: '#c27803' },
    { label: 'Non-compliant', value: 10, color: '#c81e1e' },
  ];

  const fmt = (v: string | number | null | undefined) =>
    v !== null && v !== undefined ? `$${Number(v).toLocaleString()}` : '—';

  return (
    <div className={styles.dashboard}>
      <h1 className={styles.title}>Financial Overview</h1>

      {/* KPI strip */}
      <div className={styles.kpiRow}>
        <KpiCard
          label="Total Revenue"
          value={fmt(kpiRow?.total_revenue)}
          trend={formatGrowth(kpiRow?.revenue_yoy_growth)}
          positive={Number(kpiRow?.revenue_yoy_growth ?? 0) >= 0}
        />
        <KpiCard
          label="Total Expenses"
          value={fmt(kpiRow?.total_expenses)}
          trend="—"
          positive={false}
        />
        <KpiCard
          label="Net Income"
          value={fmt(kpiRow?.net_income)}
          trend={formatGrowth(kpiRow?.net_income_yoy_growth)}
          positive={Number(kpiRow?.net_income_yoy_growth ?? 0) >= 0}
        />
        <KpiCard
          label="Operating Margin"
          value={kpiRow ? `${Number(kpiRow.operating_margin).toFixed(1)}%` : '—'}
          trend="—"
          positive={Number(kpiRow?.operating_margin ?? 0) >= 0}
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
