import { useState, useEffect } from 'react';
import { forecastingApi } from '../services/api';
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
}

export function useForecasting(months = 12, metric = 'revenue'): UseForecastingReturn {
  const [forecast, setForecast] = useState<ForecastDataPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    forecastingApi
      .getForecast(months, metric)
      .then((res) => {
        if (cancelled) return;
        const { dataPoints } = res.data.data as ForecastApiResponse;
        const mapped: ForecastDataPoint[] = dataPoints.map((d) => {
          const actualValue = Number(d.actual_total);
          const forecastValue = Number(d.projected_total);
          return {
            month: new Date(d.month).toLocaleString('default', { month: 'short', year: '2-digit' }),
            // Only show actual when a real value is present (> 0)
            actual: actualValue > 0 ? actualValue : undefined,
            forecast: forecastValue > 0 ? forecastValue : undefined,
          };
        });
        setForecast(mapped);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [months, metric]);

  return { forecast, isLoading, error };
}
