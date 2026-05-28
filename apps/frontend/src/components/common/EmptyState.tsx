import { ReactNode } from 'react';
import styles from './EmptyState.module.css';

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className={styles.empty} role="status" aria-live="polite">
      <p className={styles.title}>{title}</p>
      <p className={styles.description}>{description}</p>
      {action}
    </div>
  );
}
