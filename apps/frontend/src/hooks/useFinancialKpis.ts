import { useState, useEffect } from 'react';
import { financialsApi } from '../services/api';

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

export function useFinancialKpis(year?: number): UseFinancialKpisReturn {
  const [kpis, setKpis] = useState<FinancialKpiRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    financialsApi
      .getKpis(year ?? new Date().getFullYear())
      .then((res) => {
        if (cancelled) return;
        setKpis(res.data.data as FinancialKpiRow[]);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [year, tick]);

  const latest = kpis.length > 0 ? kpis[kpis.length - 1] : null;

  return { kpis, latest, isLoading, error, refetch: () => setTick((t) => t + 1) };
}
