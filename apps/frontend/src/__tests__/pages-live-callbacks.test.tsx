import { render, screen, waitFor } from '@testing-library/react';
import { renderHook, act } from '@testing-library/react';
import { FinancialsPage } from '../pages/Financials';
import { ForecastingPage } from '../pages/Forecasting';
import { useLiveFinancials, LiveEventPayload } from '../hooks/useLiveFinancials';
import type { useFinancials as useFinancialsHook } from '../hooks/useFinancials';
import type { useForecasting as useForecastingHook } from '../hooks/useForecasting';

type FinancialsHookState = ReturnType<typeof useFinancialsHook>;
type ForecastingHookState = ReturnType<typeof useForecastingHook>;

// ─── Page callback wiring ─────────────────────────────────────────────────
// These tests exercise the useCallback bodies that refetch + markUpdated when
// a live SSE event fires, covering lines 16–26 of Financials.tsx and 16–19
// of Forecasting.tsx.

const mockRefetchFinancials = jest.fn();
const mockRefetchKpis = jest.fn();
const mockRefetchForecast = jest.fn();

let capturedLiveOptions: Record<string, ((...args: unknown[]) => void) | undefined> = {};

jest.mock('../hooks/useLiveFinancials', () => ({
  ...jest.requireActual('../hooks/useLiveFinancials'),
  useLiveFinancials: jest.fn((opts: Record<string, unknown>) => {
    capturedLiveOptions = opts as typeof capturedLiveOptions;
    return { isConnected: false };
  }),
}));

const makeFinancialsState = (overrides: Partial<FinancialsHookState> = {}): FinancialsHookState => ({
  summary: null,
  prevSummary: null,
  revenue: [],
  isLoading: false,
  error: null,
  refetch: mockRefetchFinancials,
  ...overrides,
});

const makeForecastingState = (overrides: Partial<ForecastingHookState> = {}): ForecastingHookState => ({
  forecast: [],
  isLoading: false,
  error: null,
  refetch: mockRefetchForecast,
  ...overrides,
});

jest.mock('../hooks/useFinancials', () => ({
  useFinancials: () => makeFinancialsState(),
}));
jest.mock('../hooks/useFinancialKpis', () => ({
  useFinancialKpis: () => ({ kpis: [], latest: null, isLoading: false, error: null, refetch: mockRefetchKpis }),
}));
jest.mock('../hooks/useForecasting', () => ({
  useForecasting: () => makeForecastingState(),
}));
jest.mock('../hooks/useLastUpdated', () => ({
  useLastUpdated: () => ({ lastUpdated: null, markUpdated: jest.fn(), relativeLabel: '' }),
}));
jest.mock('../components/Charts/RevenueChart', () => ({
  RevenueChart: () => <div data-testid="revenue-chart" />,
}));
jest.mock('../components/Charts/ForecastChart', () => ({
  ForecastChart: () => <div data-testid="forecast-chart" />,
}));

describe('FinancialsPage live callback wiring', () => {
  beforeEach(() => {
    capturedLiveOptions = {};
    mockRefetchFinancials.mockClear();
    mockRefetchKpis.mockClear();
  });

  it('renders the Financials heading', () => {
    render(<FinancialsPage />);
    expect(screen.getByText('Financials')).toBeInTheDocument();
  });

  it('onKpiUpdated callback triggers refetchFinancials and refetchKpis', () => {
    render(<FinancialsPage />);
    act(() => capturedLiveOptions.onKpiUpdated?.());
    expect(mockRefetchFinancials).toHaveBeenCalledTimes(1);
    expect(mockRefetchKpis).toHaveBeenCalledTimes(1);
  });

  it('onTransactionAdded callback triggers refetchFinancials and refetchKpis', () => {
    render(<FinancialsPage />);
    act(() => capturedLiveOptions.onTransactionAdded?.());
    expect(mockRefetchFinancials).toHaveBeenCalledTimes(1);
    expect(mockRefetchKpis).toHaveBeenCalledTimes(1);
  });
});

describe('ForecastingPage live callback wiring', () => {
  beforeEach(() => {
    capturedLiveOptions = {};
    mockRefetchForecast.mockClear();
  });

  it('renders the Forecasting heading', () => {
    render(<ForecastingPage />);
    expect(screen.getByText('Forecasting')).toBeInTheDocument();
  });

  it('onForecastUpdated callback triggers refetchForecast', () => {
    render(<ForecastingPage />);
    act(() => capturedLiveOptions.onForecastUpdated?.());
    expect(mockRefetchForecast).toHaveBeenCalledTimes(1);
  });

  it('onForecastChanged callback triggers refetchForecast', () => {
    render(<ForecastingPage />);
    act(() => capturedLiveOptions.onForecastChanged?.());
    expect(mockRefetchForecast).toHaveBeenCalledTimes(1);
  });
});

// ─── useLiveFinancials — domain SSE events ────────────────────────────────
// Covers lines 115–120: kpi-updated, compliance-updated, forecast-updated.

const { useLiveFinancials: realUseLiveFinancials } = jest.requireActual<
  typeof import('../hooks/useLiveFinancials')
>('../hooks/useLiveFinancials');

function makeSseStream(eventName: string, payload: object) {
  const chunk = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  const encoded = new TextEncoder().encode(chunk);
  let readCount = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: jest.fn().mockImplementation(async () => {
          if (readCount === 0) { readCount++; return { done: false, value: encoded }; }
          return { done: true, value: undefined };
        }),
      }),
    },
  };
}

describe('useLiveFinancials — domain event callbacks', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; jest.clearAllMocks(); });

  it('dispatches kpi-updated event to onKpiUpdated callback', async () => {
    const payload: LiveEventPayload = { organization_id: 'org-1', updatedAt: '2026-01-01T00:00:00Z' };
    global.fetch = jest.fn().mockResolvedValue(makeSseStream('kpi-updated', payload));

    const onKpiUpdated = jest.fn();
    renderHook(() => realUseLiveFinancials({ onKpiUpdated }));

    await waitFor(() => expect(onKpiUpdated).toHaveBeenCalledWith(payload));
  });

  it('dispatches compliance-updated event to onComplianceUpdated callback', async () => {
    const payload: LiveEventPayload = { organization_id: 'org-2', updatedAt: '2026-02-01T00:00:00Z' };
    global.fetch = jest.fn().mockResolvedValue(makeSseStream('compliance-updated', payload));

    const onComplianceUpdated = jest.fn();
    renderHook(() => realUseLiveFinancials({ onComplianceUpdated }));

    await waitFor(() => expect(onComplianceUpdated).toHaveBeenCalledWith(payload));
  });

  it('dispatches forecast-updated event to onForecastUpdated callback', async () => {
    const payload: LiveEventPayload = { organization_id: 'org-3', updatedAt: '2026-03-01T00:00:00Z' };
    global.fetch = jest.fn().mockResolvedValue(makeSseStream('forecast-updated', payload));

    const onForecastUpdated = jest.fn();
    renderHook(() => realUseLiveFinancials({ onForecastUpdated }));

    await waitFor(() => expect(onForecastUpdated).toHaveBeenCalledWith(payload));
  });
});
