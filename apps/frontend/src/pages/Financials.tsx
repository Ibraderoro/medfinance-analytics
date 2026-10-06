import { useCallback } from 'react';
import { RevenueChart } from '../components/Charts/RevenueChart';
import { useFinancials } from '../hooks/useFinancials';
import { useFinancialKpis } from '../hooks/useFinancialKpis';
import { useLiveFinancials } from '../hooks/useLiveFinancials';
import { useLastUpdated } from '../hooks/useLastUpdated';
import { LiveBadge } from '../components/LiveBadge';
import { PageCard } from '../components/common/PageCard';
import styles from './Page.module.css';

export function FinancialsPage() {
  const { revenue, isLoading, error, refetch: refetchFinancials } = useFinancials();
  const { refetch: refetchKpis } = useFinancialKpis();
  const { markUpdated, relativeLabel } = useLastUpdated();

  const handleKpiUpdated = useCallback(() => {
    refetchFinancials();
    refetchKpis();
    markUpdated();
  }, [refetchFinancials, refetchKpis, markUpdated]);

  const handleTransactionAdded = useCallback(() => {
    refetchFinancials();
    refetchKpis();
    markUpdated();
  }, [refetchFinancials, refetchKpis, markUpdated]);

  const { isConnected } = useLiveFinancials({
    onKpiUpdated: handleKpiUpdated,
    onTransactionAdded: handleTransactionAdded,
  });

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.title}>Financials</h1>
        <div className={styles.liveStatus}>
          <LiveBadge isConnected={isConnected} />
          {relativeLabel && <span className={styles.lastUpdated}>{relativeLabel}</span>}
        </div>
      </div>
      <PageCard title="Revenue Trend" isLoading={isLoading} error={error}>
        <RevenueChart data={revenue} width={700} height={350} />
      </PageCard>
    </div>
  );
}
