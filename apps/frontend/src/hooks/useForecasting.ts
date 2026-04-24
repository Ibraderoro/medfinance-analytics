import { useState, useEffect } from 'react';
import { forecastingApi } from '../services/api';
import type { ForecastDataPoint } from '../components/Charts/ForecastChart';

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
        const { actuals } = res.data.data as {
          actuals: Array<{ month: string; total: string | number }>;
        };
        const mapped: ForecastDataPoint[] = actuals.map((d) => ({
          month: new Date(d.month).toLocaleString('default', { month: 'short', year: '2-digit' }),
          actual: Number(d.total),
        }));
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
