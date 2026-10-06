import { useState, useCallback, useEffect } from 'react';
import { financialsApi } from '../services/api';
import { useAutoRefresh } from './useAutoRefresh';

export interface FinancialKpiRow {
  month_start: string;
  fiscal_year: number;
  fiscal_month: number;
  total_revenue: string | number;
  total_expenses: string | number;
  net_income: string | number;
  gross_margin: string | number;
  operating_margin: string | number;
  burn_rate: string | number;
  cash_reserve_amount: string | number;
  runway_months: string | number;
  revenue_mom_growth: string | number;
  revenue_yoy_growth: string | number;
  net_income_mom_growth: string | number;
  net_income_yoy_growth: string | number;
}

interface UseFinancialKpisReturn {
  kpis: FinancialKpiRow[];
  latest: FinancialKpiRow | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useFinancialKpis(year?: number, liveRefresh: boolean = true): UseFinancialKpisReturn {
  const [kpis, setKpis] = useState<FinancialKpiRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(() => {
    setIsLoading(true);
    setError(null);

    financialsApi
      .getKpis(year ?? new Date().getFullYear())
      .then((res) => {
        setKpis(res.data.data as FinancialKpiRow[]);
      })
      .catch((err: Error) => {
        setError(err);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [year]);

  const { refresh } = useAutoRefresh(fetchData, 30_000, liveRefresh);

  // When liveRefresh is disabled, still fetch once on mount / year change.
  useEffect(() => {
    if (!liveRefresh) {
      fetchData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, liveRefresh]);

  const latest = kpis.length > 0 ? kpis[kpis.length - 1] : null;

  return { kpis, latest, isLoading, error, refetch: refresh };
}
