import { Component, ReactNode } from 'react';
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

/**
 * Format a growth value as a signed percentage string with one decimal place.
 *
 * @param value - A number or numeric string; may be `null` or `undefined`.
 * @returns `'—'` if `value` is `null`, `undefined`, or cannot be converted to a valid number; otherwise the value formatted as a percentage with one decimal (e.g., `+1.2%`, `-0.5%`). 
 */
function formatGrowth(value: string | number | null | undefined): string { if (value === null || value === undefined || Number.isNaN(Number(value))) return '—'; const num = Number(value); return `${num >= 0 ? '+' : ''}${num.toFixed(1)}%`; }
/**
 * Renders a centered empty-state message with a fixed minimum height and muted text color.
 *
 * @param message - The message to display inside the empty state
 * @returns The rendered empty-state React element containing `message`
 */
function EmptyState({ message }: { message: string }) { return <div style={{ minHeight: 260, display: 'grid', placeItems: 'center', color: '#4b5563' }}>{message}</div>; }

class DashboardErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() { return this.state.hasError ? <EmptyState message="Dashboard temporarily unavailable. Please refresh." /> : this.props.children; }
}

/**
 * Render the main dashboard UI for the financial overview, including KPI cards, charts, and appropriate loading or empty states.
 *
 * Subscribes to financials, KPI, forecast, and compliance hooks to populate:
 * - Four KPI cards (Total Revenue, Total Expenses, Net Income, Operating Margin) with formatted values and growth indicators.
 * - Monthly Revenue chart, Compliance Status chart, and a 12-month Revenue Forecast chart, each showing a loading indicator while data loads or an empty-state message when no data is available.
 *
 * @returns A JSX element containing the dashboard content.
 */
function DashboardContent() {
  const { revenue, isLoading: finLoading } = useFinancials();
  const { latest: kpiRow } = useFinancialKpis();
  const { forecast, isLoading: forecastLoading } = useForecasting();
  const { items: complianceItems, isLoading: complianceLoading } = useCompliance();
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

  return <div className={styles.dashboard}>
    <h1 className={styles.title}>Financial Overview</h1>
    <div className={styles.kpiRow}>
      <KpiCard label="Total Revenue" value={fmt(kpiRow?.total_revenue)} trend={formatGrowth(kpiRow?.revenue_yoy_growth)} positive={Number(kpiRow?.revenue_yoy_growth ?? 0) >= 0} />
      <KpiCard label="Total Expenses" value={fmt(kpiRow?.total_expenses)} trend="—" positive={false} />
      <KpiCard label="Net Income" value={fmt(kpiRow?.net_income)} trend={formatGrowth(kpiRow?.net_income_yoy_growth)} positive={Number(kpiRow?.net_income_yoy_growth ?? 0) >= 0} />
      <KpiCard label="Operating Margin" value={hasFiniteOperatingMargin ? `${operatingMarginNumber.toFixed(1)}%` : 'No Data Available'} trend="—" positive={hasFiniteOperatingMargin && operatingMarginNumber >= 0} />
    </div>
    <div className={styles.chartsRow}>
      <Card title="Monthly Revenue" className={styles.chartCard}>{finLoading ? <Loading /> : revenue.length > 0 ? <RevenueChart data={revenue} width={560} height={260} /> : <EmptyState message="No Data Available: revenue" />}</Card>
      <Card title="Compliance Status" className={styles.complianceCard}>{complianceLoading ? <Loading /> : complianceData.length > 0 ? <ComplianceChart data={complianceData} width={280} height={260} /> : <EmptyState message="No Data Available: compliance" />}</Card>
    </div>
    <Card title="Revenue Forecast (12 months)" className={styles.forecastCard}>{forecastLoading ? <Loading /> : forecast.length > 0 ? <ForecastChart data={forecast} width={760} height={260} /> : <EmptyState message="No Data Available: forecast" />}</Card>
  </div>;
}

/**
 * Render the dashboard UI wrapped in an error boundary to catch render-time errors.
 *
 * @returns The dashboard content (`DashboardContent`) wrapped inside `DashboardErrorBoundary`, which displays a fallback UI if a descendant throws during rendering.
 */
export function Dashboard() {
  return <DashboardErrorBoundary><DashboardContent /></DashboardErrorBoundary>;
}

interface KpiCardProps { label: string; value: string; trend: string; positive: boolean; }
/**
 * Renders a compact KPI card showing a label, a primary value, and an optional trend indicator.
 *
 * @param label - Text label for the KPI
 * @param value - Main KPI value to display
 * @param trend - Trend text to show; use `'—'` to suppress the trend indicator
 * @param positive - When `true`, the trend is styled as positive and shows an upward arrow; otherwise styled as negative with a downward arrow
 * @returns A JSX element representing the KPI card
 */
function KpiCard({ label, value, trend, positive }: KpiCardProps) { return <div className={styles.kpiCard}><span className={styles.kpiLabel}>{label}</span><span className={styles.kpiValue}>{value}</span>{trend !== '—' && <span className={`${styles.kpiTrend} ${positive ? styles.positive : styles.negative}`}>{positive ? '↑' : '↓'} {trend}</span>}</div>; }
