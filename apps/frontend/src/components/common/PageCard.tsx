import { Card } from './Card';
import { Loading } from './Loading';
import styles from '../../pages/Page.module.css';

interface PageCardProps {
  title: string;
  isLoading: boolean;
  error: Error | string | null | undefined;
  className?: string;
  children: React.ReactNode;
}

export function PageCard({ title, isLoading, error, className, children }: PageCardProps) {
  return (
    <>
      {isLoading && <Loading />}
      {error && <p className={styles.error}>Failed to load {title.toLowerCase()} data.</p>}
      {!isLoading && !error && (
        <Card title={title} className={className}>
          {children}
        </Card>
      )}
    </>
  );
}
