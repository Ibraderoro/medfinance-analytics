import { act, renderHook, waitFor } from '@testing-library/react';
import { useFinancialKpis } from '../hooks/useFinancialKpis';
import { useLiveFinancials, LiveFinancialPayload } from '../hooks/useLiveFinancials';
import { financialsApi } from '../services/api';

jest.mock('../services/api', () => ({
  financialsApi: { getKpis: jest.fn() },
}));

const makeKpiRow = (overrides: Partial<{ fiscal_year: number; total_revenue: string }> = {}) => ({
  month_start: '2026-01-01',
  fiscal_year: 2026,
  fiscal_month: 1,
  total_revenue: '200000',
  total_expenses: '120000',
  net_income: '80000',
  gross_margin: '50',
  operating_margin: '40',
  burn_rate: '10000',
  cash_reserve_amount: '500000',
  runway_months: '50',
  revenue_mom_growth: '2',
  revenue_yoy_growth: '12',
  net_income_mom_growth: '1.5',
  net_income_yoy_growth: '8',
  ...overrides,
});

describe('useFinancialKpis', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('starts loading, fetches KPIs, and returns kpis array with latest row', async () => {
    const row = makeKpiRow();
    (financialsApi.getKpis as jest.Mock).mockResolvedValueOnce({ data: { data: [row] } });

    const { result } = renderHook(() => useFinancialKpis(2026));

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.kpis).toHaveLength(1);
    expect(result.current.latest?.fiscal_year).toBe(2026);
    expect(result.current.latest?.total_revenue).toBe('200000');
    expect(result.current.error).toBeNull();
  });

  it('returns null latest when the response is an empty array', async () => {
    (financialsApi.getKpis as jest.Mock).mockResolvedValueOnce({ data: { data: [] } });

    const { result } = renderHook(() => useFinancialKpis());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.kpis).toHaveLength(0);
    expect(result.current.latest).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('sets error when the API call fails and keeps kpis empty', async () => {
    (financialsApi.getKpis as jest.Mock).mockRejectedValueOnce(new Error('network error'));

    const { result } = renderHook(() => useFinancialKpis(2025));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.kpis).toHaveLength(0);
    expect(result.current.latest).toBeNull();
  });

  it('refetch triggers a new API request and updates results', async () => {
    (financialsApi.getKpis as jest.Mock)
      .mockResolvedValueOnce({ data: { data: [makeKpiRow({ fiscal_year: 2025 })] } })
      .mockResolvedValueOnce({ data: { data: [makeKpiRow({ fiscal_year: 2026 })] } });

    const { result } = renderHook(() => useFinancialKpis(2025));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.latest?.fiscal_year).toBe(2025);

    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.latest?.fiscal_year).toBe(2026));
    expect(financialsApi.getKpis).toHaveBeenCalledTimes(2);
  });

  it('uses latest (last) row when multiple rows are returned', async () => {
    const rows = [makeKpiRow({ fiscal_year: 2025 }), makeKpiRow({ fiscal_year: 2026 })];
    (financialsApi.getKpis as jest.Mock).mockResolvedValueOnce({ data: { data: rows } });

    const { result } = renderHook(() => useFinancialKpis(2026));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.latest?.fiscal_year).toBe(2026);
    expect(result.current.kpis).toHaveLength(2);
  });
});

describe('useLiveFinancials', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('fetches from the live financials endpoint on mount', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, body: null });

    renderHook(() => useLiveFinancials({ onError: jest.fn() }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('financials/live'),
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  it('calls onError when the stream connection returns a non-ok status', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, body: null });
    const onError = jest.fn();

    renderHook(() => useLiveFinancials({ onError }));

    await waitFor(() => expect(onError).toHaveBeenCalled());
  });

  it('calls onError when fetch rejects with a non-AbortError', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('connection refused'));
    const onError = jest.fn();

    renderHook(() => useLiveFinancials({ onError }));

    await waitFor(() => expect(onError).toHaveBeenCalled());
  });

  it('does not call onError when fetch is aborted on unmount', async () => {
    const abortErr = Object.assign(new Error('Aborted'), { name: 'AbortError' });
    global.fetch = jest.fn().mockRejectedValue(abortErr);
    const onError = jest.fn();

    const { unmount } = renderHook(() => useLiveFinancials({ onError }));
    unmount();

    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(onError).not.toHaveBeenCalled();
  });

  it('dispatches snapshot events to onSnapshot callback', async () => {
    const payload: LiveFinancialPayload = {
      organization_id: 'org-abc',
      year: 2026,
      summary: { total_revenue: 100000, total_expenses: 60000, net_income: 40000 },
      latestKpi: null,
      updatedAt: '2026-01-01T00:00:00Z',
    };
    const sseChunk = `event: snapshot\ndata: ${JSON.stringify(payload)}\n\n`;
    const encoded = new TextEncoder().encode(sseChunk);

    let readCount = 0;
    const mockReader = {
      read: jest.fn().mockImplementation(async () => {
        if (readCount === 0) { readCount++; return { done: false, value: encoded }; }
        return { done: true, value: undefined };
      }),
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: { getReader: () => mockReader },
    });

    const onSnapshot = jest.fn();
    renderHook(() => useLiveFinancials({ onSnapshot }));

    await waitFor(() => expect(onSnapshot).toHaveBeenCalledWith(payload));
  });

  it('dispatches transaction-added events to onTransactionAdded callback', async () => {
    const payload: LiveFinancialPayload = {
      organization_id: 'org-1',
      year: 2026,
      summary: { total_revenue: 50000, total_expenses: 30000, net_income: 20000 },
      latestKpi: null,
      updatedAt: '2026-02-01T00:00:00Z',
    };
    const sseChunk = `event: transaction-added\ndata: ${JSON.stringify(payload)}\n\n`;
    const encoded = new TextEncoder().encode(sseChunk);

    let readCount = 0;
    const mockReader = {
      read: jest.fn().mockImplementation(async () => {
        if (readCount === 0) { readCount++; return { done: false, value: encoded }; }
        return { done: true, value: undefined };
      }),
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: { getReader: () => mockReader },
    });

    const onTransactionAdded = jest.fn();
    renderHook(() => useLiveFinancials({ onTransactionAdded }));

    await waitFor(() => expect(onTransactionAdded).toHaveBeenCalledWith(payload));
  });

  it('dispatches forecast-changed events to onForecastChanged callback', async () => {
    const payload: LiveFinancialPayload = {
      organization_id: 'org-2',
      year: 2026,
      summary: { total_revenue: 75000, total_expenses: 40000, net_income: 35000 },
      latestKpi: null,
      updatedAt: '2026-03-01T00:00:00Z',
    };
    const sseChunk = `event: forecast-changed\ndata: ${JSON.stringify(payload)}\n\n`;
    const encoded = new TextEncoder().encode(sseChunk);

    let readCount = 0;
    const mockReader = {
      read: jest.fn().mockImplementation(async () => {
        if (readCount === 0) { readCount++; return { done: false, value: encoded }; }
        return { done: true, value: undefined };
      }),
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: { getReader: () => mockReader },
    });

    const onForecastChanged = jest.fn();
    renderHook(() => useLiveFinancials({ onForecastChanged }));

    await waitFor(() => expect(onForecastChanged).toHaveBeenCalledWith(payload));
  });
});
