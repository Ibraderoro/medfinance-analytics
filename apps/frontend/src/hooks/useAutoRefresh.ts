import { useEffect, useCallback, useRef } from 'react';

/**
 * Generic polling + on-demand refresh hook.
 *
 * Calls `fetchFn` immediately on mount, then again every `intervalMs`.
 * Exposes a `refresh` callback that can be called on-demand (e.g. from an
 * SSE event handler) to trigger an immediate re-fetch without resetting the
 * polling timer.
 *
 * Cleans up the interval on unmount.
 */
export function useAutoRefresh(
  fetchFn: () => void,
  intervalMs: number = 30_000,
  enabled: boolean = true,
): { refresh: () => void } {
  // Keep a stable ref so the interval closure always sees the latest fetchFn
  // without needing to restart the timer when fetchFn identity changes.
  const fetchRef = useRef(fetchFn);
  useEffect(() => {
    fetchRef.current = fetchFn;
  });

  const refresh = useCallback(() => {
    if (enabled) fetchRef.current();
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    fetchRef.current();

    const id = setInterval(() => {
      fetchRef.current();
    }, intervalMs);

    return () => clearInterval(id);
  }, [intervalMs, enabled]);

  return { refresh };
}
