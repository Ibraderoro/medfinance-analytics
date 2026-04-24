import { Card } from '../components/common/Card';
import { RevenueChart } from '../components/Charts/RevenueChart';
import { useFinancials } from '../hooks/useFinancials';
import { Loading } from '../components/common/Loading';
import styles from './Page.module.css';

export function FinancialsPage() {
  const { revenue, isLoading, error } = useFinancials();

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Financials</h1>
      <Card title="Revenue Trend">
        {isLoading && <Loading />}
        {error && <p className={styles.error}>Failed to load data.</p>}
        {!isLoading && !error && <RevenueChart data={revenue} width={700} height={350} />}
      </Card>
    </div>
  );
}
