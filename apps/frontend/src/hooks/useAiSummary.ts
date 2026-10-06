import { useState, useCallback, useEffect } from 'react';
import { aiApi } from '../services/api';

interface UseAiSummaryReturn {
  answer: string;
  recommendations: string[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useAiSummary(): UseAiSummaryReturn {
  const [answer, setAnswer] = useState('');
  const [recommendations, setRecommendations] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(() => {
    setIsLoading(true);
    setError(null);

    aiApi
      .getSummary()
      .then((res) => {
        const { answer: ans, recommendations: recs } = res.data.data;
        setAnswer(ans ?? '');
        setRecommendations(Array.isArray(recs) ? recs : []);
      })
      .catch(() => {
        setError('Unable to load recommendations. Try again.');
        setRecommendations([]);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { answer, recommendations, isLoading, error, refetch: fetchData };
}
