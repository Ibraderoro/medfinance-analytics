import { RevenueChart } from '../components/Charts/RevenueChart';
import { useFinancials } from '../hooks/useFinancials';
import { PageCard } from '../components/common/PageCard';
import styles from './Page.module.css';

export function FinancialsPage() {
  const { revenue, isLoading, error } = useFinancials();

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Financials</h1>
      <PageCard title="Revenue Trend" isLoading={isLoading} error={error}>
        <RevenueChart data={revenue} width={700} height={350} />
      </PageCard>
    </div>
  );
}
