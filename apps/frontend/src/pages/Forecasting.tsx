import { ForecastChart } from '../components/Charts/ForecastChart';
import { useForecasting } from '../hooks/useForecasting';
import { PageCard } from '../components/common/PageCard';
import styles from './Page.module.css';

export function ForecastingPage() {
  // Horizon (12 months) and metric ('revenue') are fixed for now.
  // If user-configurable forecasting is added, promote these to state.
  const { forecast, isLoading, error } = useForecasting(12, 'revenue');

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Forecasting</h1>
      <PageCard title="12-Month Revenue Forecast" isLoading={isLoading} error={error}>
        <ForecastChart data={forecast} width={700} height={350} />
      </PageCard>
    </div>
  );
}
