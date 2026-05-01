import { act, renderHook, waitFor } from '@testing-library/react';
import { useCompliance } from '../hooks/useCompliance';
import { useFinancials } from '../hooks/useFinancials';
import { useForecasting } from '../hooks/useForecasting';
import { complianceApi, financialsApi, forecastingApi } from '../services/api';

jest.mock('../services/api', () => ({
  complianceApi: { getStatus: jest.fn() },
  financialsApi: { getSummary: jest.fn(), getRevenue: jest.fn() },
  forecastingApi: { getForecast: jest.fn() },
}));

describe('data hooks', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('loads compliance items and supports refetch', async () => {
    (complianceApi.getStatus as jest.Mock)
      .mockResolvedValueOnce({ data: { data: [{ regulation_code: 'HIPAA', status: 'compliant', last_reviewed_at: null, next_review_due_at: '2026-12-01', assigned_to: 'alice' }] } })
      .mockResolvedValueOnce({ data: { data: [{ regulation_code: 'SOX', status: 'pending', last_reviewed_at: null, next_review_due_at: '2026-12-05', assigned_to: 'bob' }] } });

    const { result } = renderHook(() => useCompliance());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.items[0].regulation_code).toBe('HIPAA');
    expect(complianceApi.getStatus).toHaveBeenCalledTimes(1);

    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.items[0].regulation_code).toBe('SOX'));
    expect(complianceApi.getStatus).toHaveBeenCalledTimes(2);
  });

  it('maps financial summary and revenue', async () => {
    (financialsApi.getSummary as jest.Mock)
      .mockResolvedValueOnce({ data: { data: { total_revenue: '100', total_expenses: '40', net_income: '60' } } })
      .mockResolvedValueOnce({ data: { data: { total_revenue: '90', total_expenses: '35', net_income: '55' } } });
    (financialsApi.getRevenue as jest.Mock).mockResolvedValueOnce({
      data: { data: [{ month: '2026-01-01T00:00:00.000Z', total: '1000' }] },
    });

    const { result } = renderHook(() => useFinancials(2026));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.summary?.net_income).toBe('60');
    expect(result.current.prevSummary?.net_income).toBe('55');
    expect(result.current.revenue[0].total).toBe(1000);
    expect(financialsApi.getSummary).toHaveBeenNthCalledWith(1, 2026);
    expect(financialsApi.getSummary).toHaveBeenNthCalledWith(2, 2025);
    expect(financialsApi.getRevenue).toHaveBeenCalledWith('2026-01-01', '2026-12-31');
  });

  it('returns error when critical financial data fails', async () => {
    (financialsApi.getSummary as jest.Mock)
      .mockRejectedValueOnce(new Error('summary failed'))
      .mockResolvedValueOnce({ data: { data: { total_revenue: '90', total_expenses: '35', net_income: '55' } } });
    (financialsApi.getRevenue as jest.Mock).mockResolvedValueOnce({ data: { data: [] } });

    const { result } = renderHook(() => useFinancials(2026));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeTruthy();
  });

  it('maps forecasting values and suppresses zero actuals', async () => {
    (forecastingApi.getForecast as jest.Mock).mockResolvedValueOnce({
      data: {
        data: {
          metric: 'revenue',
          forecastMonths: 2,
          dataPoints: [
            { month: '2026-01-01T00:00:00.000Z', metric: 'revenue', projected_total: '120', actual_total: '0' },
            { month: '2026-02-01T00:00:00.000Z', metric: 'revenue', projected_total: '140', actual_total: '110' },
          ],
        },
      },
    });

    const { result } = renderHook(() => useForecasting(2, 'revenue'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.forecast[0].actual).toBeUndefined();
    expect(result.current.forecast[1].actual).toBe(110);
    expect(result.current.forecast[1].forecast).toBe(140);
  });
});
