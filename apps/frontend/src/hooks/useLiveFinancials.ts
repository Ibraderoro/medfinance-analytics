import { useEffect } from 'react';

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api/v1';

function buildLiveFinancialsUrl(): string {
  if (BASE_URL.startsWith('http://') || BASE_URL.startsWith('https://')) {
    return `${BASE_URL.replace(/\/$/, '')}/financials/live`;
  }

  return `${BASE_URL.replace(/\/$/, '')}/financials/live`;
}

export interface LiveFinancialPayload {
  organization_id: string;
  year: number;
  summary: {
    total_revenue: number;
    total_expenses: number;
    net_income: number;
  };
  latestKpi: Record<string, unknown> | null;
  updatedAt: string;
}

interface UseLiveFinancialsOptions {
  token: string;
  onSnapshot?: (payload: LiveFinancialPayload) => void;
  onTransactionAdded?: (payload: LiveFinancialPayload) => void;
  onForecastChanged?: (payload: LiveFinancialPayload) => void;
  onError?: (error: unknown) => void;
}

/**
 * Example usage:
 * useLiveFinancials({
 *   token,
 *   onSnapshot: setDashboardData,
 *   onTransactionAdded: setDashboardData,
 *   onForecastChanged: setDashboardData,
 * });
 */
export function useLiveFinancials({
  token,
  onSnapshot,
  onTransactionAdded,
  onForecastChanged,
  onError,
}: UseLiveFinancialsOptions): void {
  useEffect(() => {
    if (!token) return;

    const controller = new AbortController();

    const consumeStream = async (): Promise<void> => {
      const response = await fetch(buildLiveFinancialsUrl(), {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${token}`,
        },
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Failed to connect to live stream (${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';

        for (const chunk of chunks) {
          const lines = chunk.split('\n');
          const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
          const data = lines.find((line) => line.startsWith('data:'))?.slice(5).trim();
          if (!event || !data) continue;

          const payload = JSON.parse(data) as LiveFinancialPayload;

          if (event === 'snapshot') onSnapshot?.(payload);
          if (event === 'transaction-added') onTransactionAdded?.(payload);
          if (event === 'forecast-changed') onForecastChanged?.(payload);
        }
      }
    };

    void consumeStream().catch((error: unknown) => {
      if ((error as { name?: string })?.name !== 'AbortError') {
        onError?.(error);
      }
    });

    return () => {
      controller.abort();
    };
  }, [token, onSnapshot, onTransactionAdded, onForecastChanged, onError]);
}
