import { useState, useEffect } from 'react';
import { financialsApi } from '../services/api';
import type { RevenueDataPoint } from '../components/Charts/RevenueChart';

interface FinancialSummary {
  total_revenue: string | number;
  total_expenses: string | number;
  net_income: string | number;
}

interface UseFinancialsReturn {
  summary: FinancialSummary | null;
  prevSummary: FinancialSummary | null;
  revenue: RevenueDataPoint[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useFinancials(year?: number): UseFinancialsReturn {
  const [summary, setSummary] = useState<FinancialSummary | null>(null);
  const [prevSummary, setPrevSummary] = useState<FinancialSummary | null>(null);
  const [revenue, setRevenue] = useState<RevenueDataPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    const currentYear = year ?? new Date().getFullYear();
    const previousYear = currentYear - 1;

    Promise.all([
      financialsApi.getSummary(currentYear),
      financialsApi.getSummary(previousYear),
      financialsApi.getRevenue(),
    ])
      .then(([summaryRes, prevSummaryRes, revenueRes]) => {
        if (cancelled) return;
        setSummary(summaryRes.data.data as FinancialSummary);
        setPrevSummary(prevSummaryRes.data.data as FinancialSummary);
        const mapped = (revenueRes.data.data as Array<{ month: string; total: string | number }>).map(
          (d) => ({
            month: new Date(d.month).toLocaleString('default', { month: 'short', year: '2-digit', timeZone: 'UTC' }),
            total: Number(d.total),
          }),
        );
        setRevenue(mapped);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [year, tick]);

  return { summary, prevSummary, revenue, isLoading, error, refetch: () => setTick((t) => t + 1) };
}
