import { useState, useEffect } from 'react';
import { complianceApi } from '../services/api';

export interface ComplianceItemRow {
  regulation_code: string;
  status: string;
  last_reviewed_at: string | null;
  next_review_due_at: string;
  assigned_to: string | null;
}

interface UseComplianceReturn {
  items: ComplianceItemRow[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useCompliance(): UseComplianceReturn {
  const [items, setItems] = useState<ComplianceItemRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    complianceApi
      .getStatus()
      .then((res) => {
        if (!cancelled) {
          setItems(res.data.data as ComplianceItemRow[]);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [tick]);

  return { items, isLoading, error, refetch: () => setTick((t) => t + 1) };
}
