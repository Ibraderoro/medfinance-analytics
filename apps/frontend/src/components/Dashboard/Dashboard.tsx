import { memo } from 'react';
import { Card } from '../common/Card';
import { RevenueChart } from '../Charts/RevenueChart';
import { ForecastChart } from '../Charts/ForecastChart';
import { ComplianceChart } from '../Charts/ComplianceChart';
import { useFinancials } from '../../hooks/useFinancials';
import { useFinancialKpis } from '../../hooks/useFinancialKpis';
import { useForecasting } from '../../hooks/useForecasting';
import { useCompliance } from '../../hooks/useCompliance';
import { Loading } from '../common/Loading';
import { EmptyState } from '../common/EmptyState';
import { ErrorBoundary } from '../common/ErrorBoundary';
import styles from './Dashboard.module.css';

function formatGrowth(value: string | number | null | undefined): string { if (value === null || value === undefined || Number.isNaN(Number(value))) return '—'; const num = Number(value); return `${num >= 0 ? '+' : ''}${num.toFixed(1)}%`; }

function DashboardContent() {
  const { revenue, isLoading: finLoading, error: financialError } = useFinancials();
  const { latest: kpiRow, error: kpiError } = useFinancialKpis();
  const { forecast, isLoading: forecastLoading, error: forecastError } = useForecasting();
  const { items: complianceItems, isLoading: complianceLoading, error: complianceError } = useCompliance();
  const complianceData = [
    { label: 'Compliant', value: complianceItems.filter((i) => i.status === 'compliant').length, color: '#057a55' },
    { label: 'Review', value: complianceItems.filter((i) => i.status === 'under_review').length, color: '#c27803' },
    { label: 'Non-compliant', value: complianceItems.filter((i) => i.status === 'non_compliant').length, color: '#c81e1e' },
  ].filter((item) => item.value > 0);
  const fmt = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return 'No Data Available';
    const value = Number(v);
    return Number.isFinite(value) ? `$${value.toLocaleString()}` : 'No Data Available';
  };

  const operatingMarginNumber = Number(kpiRow?.operating_margin);
  const hasFiniteOperatingMargin = Number.isFinite(operatingMarginNumber);
  const hasDashboardError = Boolean(financialError || kpiError || forecastError || complianceError);

  return <div className={styles.dashboard}>
    <h1 className={styles.title}>Financial Overview</h1>
    {hasDashboardError && (
      <div className={styles.alert} role="alert">
        Dashboard temporarily unavailable. Please refresh.
      </div>
    )}
    <div className={styles.kpiRow}>
      <KpiCard label="Total Revenue" value={fmt(kpiRow?.total_revenue)} trend={formatGrowth(kpiRow?.revenue_yoy_growth)} positive={Number(kpiRow?.revenue_yoy_growth ?? 0) >= 0} />
      <KpiCard label="Total Expenses" value={fmt(kpiRow?.total_expenses)} trend="—" positive={false} />
      <KpiCard label="Net Income" value={fmt(kpiRow?.net_income)} trend={formatGrowth(kpiRow?.net_income_yoy_growth)} positive={Number(kpiRow?.net_income_yoy_growth ?? 0) >= 0} />
      <KpiCard label="Operating Margin" value={hasFiniteOperatingMargin ? `${operatingMarginNumber.toFixed(1)}%` : 'No Data Available'} trend="—" positive={hasFiniteOperatingMargin && operatingMarginNumber >= 0} />
    </div>
    <div className={styles.chartsRow}>
      <Card title="Monthly Revenue" className={styles.chartCard}>{finLoading ? <Loading message="Loading revenue trends" /> : revenue.length > 0 ? <RevenueChart data={revenue} width={560} height={260} /> : <EmptyState title="No revenue data" description="Try broadening the selected time range or importing financial transactions." />}</Card>
      <Card title="Compliance Status" className={styles.complianceCard}>{complianceLoading ? <Loading message="Loading compliance posture" /> : complianceData.length > 0 ? <ComplianceChart data={complianceData} width={280} height={260} /> : <EmptyState title="No compliance records" description="No controls have been assessed yet for this organization." />}</Card>
    </div>
    <Card title="Revenue Forecast (12 months)" className={styles.forecastCard}>{forecastLoading ? <Loading message="Building forecast model" /> : forecast.length > 0 ? <ForecastChart data={forecast} width={760} height={260} /> : <EmptyState title="No forecast available" description="Forecasting requires historical monthly data to compute reliable trends." />}</Card>
  </div>;
}

export function Dashboard() {
  return <ErrorBoundary fallbackTitle="Dashboard temporarily unavailable"><DashboardContent /></ErrorBoundary>;
}

interface KpiCardProps { label: string; value: string; trend: string; positive: boolean; }
const KpiCard = memo(function KpiCard({ label, value, trend, positive }: KpiCardProps) { return <div className={styles.kpiCard} role="group" aria-label={`${label} KPI`}><span className={styles.kpiLabel}>{label}</span><span className={styles.kpiValue}>{value}</span>{trend !== '—' && <span className={`${styles.kpiTrend} ${positive ? styles.positive : styles.negative}`}>{positive ? '↑' : '↓'} {trend}</span>}</div>; });
