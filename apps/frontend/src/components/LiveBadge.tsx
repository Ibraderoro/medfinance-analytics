import styles from './LiveBadge.module.css';

interface LiveBadgeProps {
  isConnected: boolean;
}

/**
 * Small status badge indicating whether the SSE live stream is connected.
 * Shows a green dot + "Live" when connected, grey dot + "Offline" otherwise.
 */
export function LiveBadge({ isConnected }: LiveBadgeProps) {
  return (
    <span className={`${styles.badge} ${isConnected ? styles.live : styles.offline}`} aria-label={isConnected ? 'Live updates active' : 'Live updates offline'}>
      <span className={styles.dot} aria-hidden="true" />
      {isConnected ? 'Live' : 'Offline'}
    </span>
  );
}
