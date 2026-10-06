import { useState, useCallback, useEffect } from 'react';
import { forecastingApi } from '../services/api';
import { useAutoRefresh } from './useAutoRefresh';
import type { ForecastDataPoint } from '../components/Charts/ForecastChart';

interface ApiDataPoint {
  month: string;
  metric: string;
  projected_total: string | number;
  actual_total: string | number;
}

interface ForecastApiResponse {
  metric: string;
  forecastMonths: number;
  dataPoints: ApiDataPoint[];
}

interface UseForecastingReturn {
  forecast: ForecastDataPoint[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useForecasting(months = 12, metric = 'revenue', liveRefresh: boolean = true): UseForecastingReturn {
  const [forecast, setForecast] = useState<ForecastDataPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(() => {
    setIsLoading(true);
    setError(null);

    forecastingApi
      .getForecast(months, metric)
      .then((res) => {
        const { dataPoints } = res.data.data as ForecastApiResponse;
        const mapped: ForecastDataPoint[] = dataPoints.map((d) => {
          const actualValue = Number(d.actual_total);
          const forecastValue = Number(d.projected_total);
          return {
            month: new Date(d.month).toLocaleString('default', { month: 'short', year: '2-digit', timeZone: 'UTC' }),
            // Only show actual when a real value is present (> 0)
            actual: actualValue > 0 ? actualValue : undefined,
            forecast: forecastValue > 0 ? forecastValue : undefined,
          };
        });
        setForecast(mapped);
      })
      .catch((err: Error) => {
        setError(err);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [months, metric]);

  const { refresh } = useAutoRefresh(fetchData, 30_000, liveRefresh);

  // When liveRefresh is disabled, still fetch once on mount / param change.
  useEffect(() => {
    if (!liveRefresh) {
      fetchData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [months, metric, liveRefresh]);

  return { forecast, isLoading, error, refetch: refresh };
}
