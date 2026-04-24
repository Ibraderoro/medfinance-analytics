import { Card } from '../components/common/Card';
import { ForecastChart } from '../components/Charts/ForecastChart';
import { useForecasting } from '../hooks/useForecasting';
import { Loading } from '../components/common/Loading';
import styles from './Page.module.css';

export function ForecastingPage() {
  const { forecast, isLoading, error } = useForecasting(12, 'revenue');

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Forecasting</h1>
      <Card title="12-Month Revenue Forecast">
        {isLoading && <Loading />}
        {error && <p className={styles.error}>Failed to load forecast data.</p>}
        {!isLoading && !error && <ForecastChart data={forecast} width={700} height={350} />}
      </Card>
    </div>
  );
}
