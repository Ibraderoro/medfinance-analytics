import styles from './Loading.module.css';

interface LoadingProps {
  message?: string;
}

export function Loading({ message = 'Loading…' }: LoadingProps) {
  return (
    <div className={styles.wrapper} role="status" aria-live="polite">
      <div className={styles.spinner} aria-hidden="true" />
      <span className={styles.message}>{message}</span>
    </div>
  );
}
