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
    const startDate = `${currentYear}-01-01`;
    const endDate = `${currentYear}-12-31`;

    Promise.allSettled([
      financialsApi.getSummary(currentYear),
      financialsApi.getSummary(previousYear),
      financialsApi.getRevenue(startDate, endDate),
    ])
      .then(([summaryRes, prevSummaryRes, revenueRes]) => {
        if (cancelled) return;

        if (summaryRes.status === 'fulfilled') {
          setSummary(summaryRes.value.data.data as FinancialSummary);
        }

        if (prevSummaryRes.status === 'fulfilled') {
          setPrevSummary(prevSummaryRes.value.data.data as FinancialSummary);
        }

        if (revenueRes.status === 'fulfilled') {
          const rawData = revenueRes.value.data?.data;
          if (Array.isArray(rawData)) {
            const mapped = rawData.map((d: any) => ({
              month: new Date(d.month).toLocaleString('default', {
                month: 'short',
                year: '2-digit',
                timeZone: 'UTC',
              }),
              total: Number(d.total),
            }));
            setRevenue(mapped);
          } else {
            setRevenue([]);
          }
        }

        if (
          summaryRes.status === 'rejected' ||
          revenueRes.status === 'rejected'
        ) {
          throw new Error('Failed to load critical financial data');
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [year, tick]);

  return {
    summary,
    prevSummary,
    revenue,
    isLoading,
    error,
    refetch: () => setTick((t) => t + 1),
  };
}
