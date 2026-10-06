import { useCallback } from 'react';
import { ForecastChart } from '../components/Charts/ForecastChart';
import { useForecasting } from '../hooks/useForecasting';
import { useLiveFinancials } from '../hooks/useLiveFinancials';
import { useLastUpdated } from '../hooks/useLastUpdated';
import { LiveBadge } from '../components/LiveBadge';
import { PageCard } from '../components/common/PageCard';
import styles from './Page.module.css';

export function ForecastingPage() {
  // Horizon (12 months) and metric ('revenue') are fixed for now.
  // If user-configurable forecasting is added, promote these to state.
  const { forecast, isLoading, error, refetch: refetchForecast } = useForecasting(12, 'revenue');
  const { markUpdated, relativeLabel } = useLastUpdated();

  const handleForecastEvent = useCallback(() => {
    refetchForecast();
    markUpdated();
  }, [refetchForecast, markUpdated]);

  const { isConnected } = useLiveFinancials({
    onForecastUpdated: handleForecastEvent,
    onForecastChanged: handleForecastEvent,
  });

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.title}>Forecasting</h1>
        <div className={styles.liveStatus}>
          <LiveBadge isConnected={isConnected} />
          {relativeLabel && <span className={styles.lastUpdated}>{relativeLabel}</span>}
        </div>
      </div>
      <PageCard title="12-Month Revenue Forecast" isLoading={isLoading} error={error}>
        <ForecastChart data={forecast} width={700} height={350} />
      </PageCard>
    </div>
  );
}
