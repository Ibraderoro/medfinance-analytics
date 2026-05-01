import { Component, ErrorInfo, ReactNode } from 'react';
import { Card } from '../common/Card';
import { RevenueChart } from '../Charts/RevenueChart';
import { ForecastChart } from '../Charts/ForecastChart';
import { ComplianceChart } from '../Charts/ComplianceChart';
import { useFinancials } from '../../hooks/useFinancials';
import { useFinancialKpis } from '../../hooks/useFinancialKpis';
import { useForecasting } from '../../hooks/useForecasting';
import { useCompliance } from '../../hooks/useCompliance';
import { Loading } from '../common/Loading';
import styles from './Dashboard.module.css';

function formatGrowth(value: string | number | null | undefined): string { if (value === null || value === undefined || Number.isNaN(Number(value))) return '—'; const num = Number(value); return `${num >= 0 ? '+' : ''}${num.toFixed(1)}%`; }
function EmptyState({ message }: { message: string }) { return <div style={{ minHeight: 260, display: 'grid', placeItems: 'center', color: '#4b5563' }}>{message}</div>; }

class DashboardErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(_error: Error, _errorInfo: ErrorInfo): void {}
  render() { return this.state.hasError ? <EmptyState message="Dashboard temporarily unavailable. Please refresh." /> : this.props.children; }
}

export function Dashboard() {
  const { revenue, isLoading: finLoading } = useFinancials();
  const { latest: kpiRow } = useFinancialKpis();
  const { forecast, isLoading: forecastLoading } = useForecasting();
  const { items: complianceItems, isLoading: complianceLoading } = useCompliance();
  const complianceData = [
    { label: 'Compliant', value: complianceItems.filter((i) => i.status === 'compliant').length, color: '#057a55' },
    { label: 'Review', value: complianceItems.filter((i) => i.status === 'under_review').length, color: '#c27803' },
    { label: 'Non-compliant', value: complianceItems.filter((i) => i.status === 'non_compliant').length, color: '#c81e1e' },
  ].filter((item) => item.value > 0);
  const fmt = (v: string | number | null | undefined) => (v !== null && v !== undefined ? `$${Number(v).toLocaleString()}` : 'No Data Available');

  return <DashboardErrorBoundary><div className={styles.dashboard}>
    <h1 className={styles.title}>Financial Overview</h1>
    <div className={styles.kpiRow}>
      <KpiCard label="Total Revenue" value={fmt(kpiRow?.total_revenue)} trend={formatGrowth(kpiRow?.revenue_yoy_growth)} positive={Number(kpiRow?.revenue_yoy_growth ?? 0) >= 0} />
      <KpiCard label="Total Expenses" value={fmt(kpiRow?.total_expenses)} trend="—" positive={false} />
      <KpiCard label="Net Income" value={fmt(kpiRow?.net_income)} trend={formatGrowth(kpiRow?.net_income_yoy_growth)} positive={Number(kpiRow?.net_income_yoy_growth ?? 0) >= 0} />
      <KpiCard label="Operating Margin" value={kpiRow ? `${Number(kpiRow.operating_margin).toFixed(1)}%` : 'No Data Available'} trend="—" positive={Number(kpiRow?.operating_margin ?? 0) >= 0} />
    </div>
    <div className={styles.chartsRow}>
      <Card title="Monthly Revenue" className={styles.chartCard}>{finLoading ? <Loading /> : revenue.length > 0 ? <RevenueChart data={revenue} width={560} height={260} /> : <EmptyState message="No Data Available: revenue" />}</Card>
      <Card title="Compliance Status" className={styles.complianceCard}>{complianceLoading ? <Loading /> : complianceData.length > 0 ? <ComplianceChart data={complianceData} width={280} height={260} /> : <EmptyState message="No Data Available: compliance" />}</Card>
    </div>
    <Card title="Revenue Forecast (12 months)" className={styles.forecastCard}>{forecastLoading ? <Loading /> : forecast.length > 0 ? <ForecastChart data={forecast} width={760} height={260} /> : <EmptyState message="No Data Available: forecast" />}</Card>
  </div></DashboardErrorBoundary>;
}

interface KpiCardProps { label: string; value: string; trend: string; positive: boolean; }
function KpiCard({ label, value, trend, positive }: KpiCardProps) { return <div className={styles.kpiCard}><span className={styles.kpiLabel}>{label}</span><span className={styles.kpiValue}>{value}</span>{trend !== '—' && <span className={`${styles.kpiTrend} ${positive ? styles.positive : styles.negative}`}>{positive ? '↑' : '↓'} {trend}</span>}</div>; }
