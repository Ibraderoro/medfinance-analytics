import { useState, useEffect, useCallback } from 'react';

/**
 * Tracks the time of the last data refresh and returns a human-readable
 * relative string like "just now", "30s ago", "2m ago", etc.
 *
 * Returns `{ lastUpdated: Date | null, markUpdated: () => void, relativeLabel: string }`.
 * Call `markUpdated()` whenever fresh data arrives.
 */
export function useLastUpdated() {
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [, setTick] = useState(0);

  // Re-render every 10 seconds so the label stays fresh.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  const markUpdated = useCallback(() => {
    setLastUpdated(new Date());
  }, []);

  const relativeLabel = (() => {
    if (!lastUpdated) return '';
    const diffMs = Date.now() - lastUpdated.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    if (diffSecs < 10) return 'Updated just now';
    if (diffSecs < 60) return `Updated ${diffSecs}s ago`;
    const diffMins = Math.floor(diffSecs / 60);
    if (diffMins < 60) return `Updated ${diffMins}m ago`;
    return `Updated ${Math.floor(diffMins / 60)}h ago`;
  })();

  return { lastUpdated, markUpdated, relativeLabel };
}
