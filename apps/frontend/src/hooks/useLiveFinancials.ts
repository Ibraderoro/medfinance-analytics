import { useEffect, useState } from 'react';

declare const __MEDFINANCE_API_URL__: string | undefined;

const BASE_URL = typeof __MEDFINANCE_API_URL__ !== 'undefined' && __MEDFINANCE_API_URL__
  ? __MEDFINANCE_API_URL__
  : '/api/v1';

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

/** Generic payload for domain-specific live events (kpi-updated, compliance-updated, forecast-updated). */
export interface LiveEventPayload {
  organization_id: string;
  updatedAt: string;
  [key: string]: unknown;
}

interface UseLiveFinancialsOptions {
  onSnapshot?: (payload: LiveFinancialPayload) => void;
  onTransactionAdded?: (payload: LiveFinancialPayload) => void;
  onForecastChanged?: (payload: LiveFinancialPayload) => void;
  /** Called when a `kpi-updated` SSE event is received. */
  onKpiUpdated?: (payload: LiveEventPayload) => void;
  /** Called when a `compliance-updated` SSE event is received. */
  onComplianceUpdated?: (payload: LiveEventPayload) => void;
  /** Called when a `forecast-updated` SSE event is received. */
  onForecastUpdated?: (payload: LiveEventPayload) => void;
  onError?: (error: unknown) => void;
}

interface UseLiveFinancialsResult {
  isConnected: boolean;
}

/**
 * Example usage:
 * useLiveFinancials({
 *   onSnapshot: setDashboardData,
 *   onTransactionAdded: setDashboardData,
 *   onForecastChanged: setDashboardData,
 *   onKpiUpdated: () => refetchKpis(),
 *   onComplianceUpdated: () => refetchCompliance(),
 *   onForecastUpdated: () => refetchForecast(),
 * });
 */
export function useLiveFinancials({
  onSnapshot,
  onTransactionAdded,
  onForecastChanged,
  onKpiUpdated,
  onComplianceUpdated,
  onForecastUpdated,
  onError,
}: UseLiveFinancialsOptions): UseLiveFinancialsResult {
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    const consumeStream = async (): Promise<void> => {
      const response = await fetch(buildLiveFinancialsUrl(), {
        method: 'GET',
        headers: { Accept: 'text/event-stream' },
        credentials: 'include',
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Failed to connect to live stream (${response.status})`);
      }

      setIsConnected(true);

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

          if (event === 'snapshot' || event === 'transaction-added' || event === 'forecast-changed') {
            const payload = JSON.parse(data) as LiveFinancialPayload;
            if (event === 'snapshot') onSnapshot?.(payload);
            if (event === 'transaction-added') onTransactionAdded?.(payload);
            if (event === 'forecast-changed') onForecastChanged?.(payload);
          } else if (event === 'kpi-updated') {
            onKpiUpdated?.(JSON.parse(data) as LiveEventPayload);
          } else if (event === 'compliance-updated') {
            onComplianceUpdated?.(JSON.parse(data) as LiveEventPayload);
          } else if (event === 'forecast-updated') {
            onForecastUpdated?.(JSON.parse(data) as LiveEventPayload);
          }
        }
      }
    };

    void consumeStream().catch((error: unknown) => {
      setIsConnected(false);
      if ((error as { name?: string })?.name !== 'AbortError') {
        onError?.(error);
      }
    });

    return () => {
      controller.abort();
      setIsConnected(false);
    };
  }, [onSnapshot, onTransactionAdded, onForecastChanged, onKpiUpdated, onComplianceUpdated, onForecastUpdated, onError]);

  return { isConnected };
}
