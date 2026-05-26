import { render, screen } from '@testing-library/react';
import { DashboardPage } from '../pages/Dashboard';
import { FinancialsPage } from '../pages/Financials';
import { ForecastingPage } from '../pages/Forecasting';
import type { useFinancials as useFinancialsHook } from '../hooks/useFinancials';
import type { useForecasting as useForecastingHook } from '../hooks/useForecasting';

type FinancialsHookState = ReturnType<typeof useFinancialsHook>;
type ForecastingHookState = ReturnType<typeof useForecastingHook>;

const createFinancialsState = (
  overrides: Partial<FinancialsHookState> = {},
): FinancialsHookState => ({
  summary: null,
  prevSummary: null,
  revenue: [],
  isLoading: false,
  error: null,
  refetch: jest.fn(),
  ...overrides,
});

const createForecastingState = (
  overrides: Partial<ForecastingHookState> = {},
): ForecastingHookState => ({
  forecast: [],
  isLoading: false,
  error: null,
  ...overrides,
});

jest.mock('../components/Dashboard/Dashboard', () => ({
  Dashboard: () => <div data-testid="dashboard-component">Dashboard Component</div>,
}));

const mockUseFinancials = jest.fn<
  FinancialsHookState,
  Parameters<typeof useFinancialsHook>
>(() => createFinancialsState());
jest.mock('../hooks/useFinancials', () => ({
  useFinancials: (...args: Parameters<typeof useFinancialsHook>) => mockUseFinancials(...args),
}));

const mockUseForecasting = jest.fn<
  ForecastingHookState,
  Parameters<typeof useForecastingHook>
>(() => createForecastingState());
jest.mock('../hooks/useForecasting', () => ({
  useForecasting: (...args: Parameters<typeof useForecastingHook>) => mockUseForecasting(...args),
}));

jest.mock('../components/Charts/RevenueChart', () => ({
  RevenueChart: () => <div data-testid="revenue-chart">Revenue Chart</div>,
}));

jest.mock('../components/Charts/ForecastChart', () => ({
  ForecastChart: () => <div data-testid="forecast-chart">Forecast Chart</div>,
}));

describe('page components', () => {
  beforeEach(() => {
    mockUseFinancials.mockReturnValue(createFinancialsState());
    mockUseForecasting.mockReturnValue(createForecastingState());
  });

  it('DashboardPage renders the Dashboard component', () => {
    render(<DashboardPage />);
    expect(screen.getByTestId('dashboard-component')).toBeInTheDocument();
  });

  it('FinancialsPage renders the page heading', () => {
    render(<FinancialsPage />);
    expect(screen.getByText('Financials')).toBeInTheDocument();
  });

  it('FinancialsPage renders the RevenueChart inside a PageCard', () => {
    render(<FinancialsPage />);
    expect(screen.getByText('Revenue Trend')).toBeInTheDocument();
    expect(screen.getByTestId('revenue-chart')).toBeInTheDocument();
  });

  it('FinancialsPage shows loading state while data loads', () => {
    mockUseFinancials.mockReturnValueOnce(createFinancialsState({ isLoading: true }));
    render(<FinancialsPage />);
    expect(screen.getByText('Financials')).toBeInTheDocument();
    expect(screen.queryByTestId('revenue-chart')).not.toBeInTheDocument();
  });

  it('FinancialsPage shows error state when financials fail', () => {
    mockUseFinancials.mockReturnValueOnce(
      createFinancialsState({ error: new Error('financials failed') }),
    );
    render(<FinancialsPage />);
    expect(screen.getByText('Financials')).toBeInTheDocument();
  });

  it('ForecastingPage renders the page heading', () => {
    render(<ForecastingPage />);
    expect(screen.getByText('Forecasting')).toBeInTheDocument();
  });

  it('ForecastingPage renders the ForecastChart inside a PageCard', () => {
    render(<ForecastingPage />);
    expect(screen.getByText('12-Month Revenue Forecast')).toBeInTheDocument();
    expect(screen.getByTestId('forecast-chart')).toBeInTheDocument();
  });

  it('ForecastingPage shows loading state while data loads', () => {
    mockUseForecasting.mockReturnValueOnce(createForecastingState({ isLoading: true }));
    render(<ForecastingPage />);
    expect(screen.getByText('Forecasting')).toBeInTheDocument();
    expect(screen.queryByTestId('forecast-chart')).not.toBeInTheDocument();
  });

  it('ForecastingPage shows error state when forecasting fails', () => {
    mockUseForecasting.mockReturnValueOnce(
      createForecastingState({ error: new Error('forecast failed') }),
    );
    render(<ForecastingPage />);
    expect(screen.getByText('Forecasting')).toBeInTheDocument();
  });
});
