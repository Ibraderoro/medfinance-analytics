import { useAiSummary } from '../../hooks/useAiSummary';
import styles from './AiRecommendations.module.css';

type Severity = 'critical' | 'warning' | 'info';

const CRITICAL_KEYWORDS = ['critical', 'urgent', 'warning', 'risk', 'deficit'];
const WARNING_KEYWORDS = ['review', 'monitor', 'consider', 'watch'];

function inferSeverity(text: string): Severity {
  const lower = text.toLowerCase();
  if (CRITICAL_KEYWORDS.some((kw) => lower.includes(kw))) return 'critical';
  if (WARNING_KEYWORDS.some((kw) => lower.includes(kw))) return 'warning';
  return 'info';
}

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  warning: 'Warning',
  info: 'Info',
};

function RefreshIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10M1 14l5.36 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

export function AiRecommendations() {
  const { recommendations, isLoading, error, refetch } = useAiSummary();

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={styles.title}>AI Recommendations</span>
        <button
          className={styles.refreshButton}
          onClick={refetch}
          aria-label="Refresh AI recommendations"
          disabled={isLoading}
        >
          <RefreshIcon />
        </button>
      </div>
      <p className={styles.subtitle}>Powered by AI · Based on your live financial data</p>

      {isLoading && (
        <div className={styles.skeletonList} aria-busy="true" aria-label="Loading recommendations">
          <div className={styles.skeleton} />
          <div className={styles.skeleton} />
          <div className={styles.skeleton} />
        </div>
      )}

      {!isLoading && error && (
        <p className={styles.errorText}>{error}</p>
      )}

      {!isLoading && !error && recommendations.length === 0 && (
        <p className={styles.emptyText}>No recommendations available.</p>
      )}

      {!isLoading && !error && recommendations.length > 0 && (
        <ol className={styles.list}>
          {recommendations.map((rec, i) => {
            const severity = inferSeverity(rec);
            return (
              <li key={i} className={styles.item}>
                <span className={`${styles.badge} ${styles[severity]}`}>
                  {SEVERITY_LABEL[severity]}
                </span>
                <span className={styles.recText}>{rec}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
