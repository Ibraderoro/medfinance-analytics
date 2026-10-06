import { useState, useCallback, useEffect } from 'react';
import { complianceApi } from '../services/api';
import { useAutoRefresh } from './useAutoRefresh';

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

export function useCompliance(liveRefresh: boolean = true): UseComplianceReturn {
  const [items, setItems] = useState<ComplianceItemRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(() => {
    setIsLoading(true);
    setError(null);

    complianceApi
      .getStatus()
      .then((res) => {
        setItems(res.data.data as ComplianceItemRow[]);
      })
      .catch((err: Error) => {
        setError(err);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  const { refresh } = useAutoRefresh(fetchData, 30_000, liveRefresh);

  // When liveRefresh is disabled, still fetch once on mount.
  useEffect(() => {
    if (!liveRefresh) {
      fetchData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveRefresh]);

  return { items, isLoading, error, refetch: refresh };
}
