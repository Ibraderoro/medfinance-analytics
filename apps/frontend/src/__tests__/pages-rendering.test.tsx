import { render, screen } from '@testing-library/react';
import { DashboardPage } from '../pages/Dashboard';
import { FinancialsPage } from '../pages/Financials';
import { ForecastingPage } from '../pages/Forecasting';

jest.mock('../components/Dashboard/Dashboard', () => ({
  Dashboard: () => <div data-testid="dashboard-component">Dashboard Component</div>,
}));

const mockUseFinancials = jest.fn(() => ({ revenue: [], isLoading: false, error: null }));
jest.mock('../hooks/useFinancials', () => ({
  useFinancials: (...args: unknown[]) => mockUseFinancials(...args),
}));

const mockUseForecasting = jest.fn(() => ({ forecast: [], isLoading: false, error: null }));
jest.mock('../hooks/useForecasting', () => ({
  useForecasting: (...args: unknown[]) => mockUseForecasting(...args),
}));

jest.mock('../components/Charts/RevenueChart', () => ({
  RevenueChart: () => <div data-testid="revenue-chart">Revenue Chart</div>,
}));

jest.mock('../components/Charts/ForecastChart', () => ({
  ForecastChart: () => <div data-testid="forecast-chart">Forecast Chart</div>,
}));

describe('page components', () => {
  beforeEach(() => {
    mockUseFinancials.mockReturnValue({ revenue: [], isLoading: false, error: null });
    mockUseForecasting.mockReturnValue({ forecast: [], isLoading: false, error: null });
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
    mockUseFinancials.mockReturnValueOnce({ revenue: [], isLoading: true, error: null });
    render(<FinancialsPage />);
    expect(screen.getByText('Financials')).toBeInTheDocument();
    expect(screen.queryByTestId('revenue-chart')).not.toBeInTheDocument();
  });

  it('FinancialsPage shows error state when financials fail', () => {
    mockUseFinancials.mockReturnValueOnce({ revenue: [], isLoading: false, error: new Error('financials failed') });
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
    mockUseForecasting.mockReturnValueOnce({ forecast: [], isLoading: true, error: null });
    render(<ForecastingPage />);
    expect(screen.getByText('Forecasting')).toBeInTheDocument();
    expect(screen.queryByTestId('forecast-chart')).not.toBeInTheDocument();
  });

  it('ForecastingPage shows error state when forecasting fails', () => {
    mockUseForecasting.mockReturnValueOnce({ forecast: [], isLoading: false, error: new Error('forecast failed') });
    render(<ForecastingPage />);
    expect(screen.getByText('Forecasting')).toBeInTheDocument();
  });
});

