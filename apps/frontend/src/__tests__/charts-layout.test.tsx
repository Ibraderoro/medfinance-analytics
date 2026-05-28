import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RevenueChart } from '../components/Charts/RevenueChart';
import { ForecastChart } from '../components/Charts/ForecastChart';
import { ComplianceChart } from '../components/Charts/ComplianceChart';
import { Sidebar } from '../components/Layout/Sidebar';
import { Header } from '../components/Layout/Header';
import { Layout } from '../components/Layout/Layout';
import { authApi } from '../services/api';
import userEvent from '@testing-library/user-event';

jest.mock('../services/api', () => ({
  authApi: {
    logout: jest.fn().mockResolvedValue({}),
  },
}));

const navigate = jest.fn();
jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

const revenueData = [
  { month: 'Jan 26', total: 10000 },
  { month: 'Feb 26', total: 15000 },
  { month: 'Mar 26', total: 12000 },
];

const forecastData = [
  { month: 'Jan 26', actual: 10000, forecast: 11000 },
  { month: 'Feb 26', actual: undefined, forecast: 13000 },
];

const complianceData = [
  { label: 'Compliant', value: 5, color: '#057a55' },
  { label: 'Review', value: 2, color: '#c27803' },
  { label: 'Non-compliant', value: 1, color: '#c81e1e' },
];

describe('chart components', () => {
  it('RevenueChart renders an svg element with default dimensions', () => {
    const { container } = render(<RevenueChart data={[]} />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('RevenueChart renders with data without throwing', () => {
    const { container } = render(<RevenueChart data={revenueData} width={400} height={200} />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('ForecastChart renders an svg element with default dimensions', () => {
    const { container } = render(<ForecastChart data={[]} />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('ForecastChart renders with mixed actual/forecast data without throwing', () => {
    const { container } = render(<ForecastChart data={forecastData} width={400} height={200} />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('ComplianceChart renders an svg element with default dimensions', () => {
    const { container } = render(<ComplianceChart data={[]} />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('ComplianceChart renders with compliance data without throwing', () => {
    const { container } = render(<ComplianceChart data={complianceData} width={320} height={300} />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});

describe('layout components', () => {
  it('Sidebar renders primary navigation with all five app links', () => {
    const { getByRole, getByLabelText } = render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Sidebar /></MemoryRouter>);
    expect(getByRole('navigation', { name: 'Primary application navigation' })).toBeInTheDocument();
    expect(getByLabelText('Dashboard')).toBeInTheDocument();
    expect(getByLabelText('Financials')).toBeInTheDocument();
    expect(getByLabelText('Forecasting')).toBeInTheDocument();
    expect(getByLabelText('Compliance')).toBeInTheDocument();
    expect(getByLabelText('Billing')).toBeInTheDocument();
  });

  it('marks the active sidebar link for the current route', () => {
    const { getByLabelText } = render(
      <MemoryRouter initialEntries={['/dashboard']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Sidebar />
      </MemoryRouter>,
    );
    expect(getByLabelText('Dashboard')).toHaveAttribute('aria-current', 'page');
    expect(getByLabelText('Billing')).not.toHaveAttribute('aria-current');
  });

  it('Header renders the application logo and logout button', () => {
    const { getByText, getByRole } = render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Header /></MemoryRouter>);
    expect(getByText('MedFinance Analytics')).toBeInTheDocument();
    expect(getByRole('button', { name: /log out/i })).toBeInTheDocument();
  });

  it('Header renders dark-mode toggle label and handles theme toggling', async () => {
    const onToggleTheme = jest.fn();
    const { getByRole } = render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Header theme="dark" onToggleTheme={onToggleTheme} />
      </MemoryRouter>,
    );

    expect(getByRole('button', { name: /toggle dark mode/i })).toHaveTextContent('☀️ Light');
    await userEvent.click(getByRole('button', { name: /toggle dark mode/i }));
    expect(onToggleTheme).toHaveBeenCalledTimes(1);
  });

  it('Header logout clears the session and navigates to /login', async () => {
    const { getByRole } = render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Header /></MemoryRouter>);
    const dispatchSpy = jest.spyOn(window, 'dispatchEvent');

    await userEvent.click(getByRole('button', { name: /log out/i }));

    expect(authApi.logout).toHaveBeenCalled();
    expect(sessionStorage.getItem('auth_session_active')).toBeNull();
    expect(dispatchSpy).toHaveBeenCalledWith(expect.any(Event));
    expect(navigate).toHaveBeenCalledWith('/login', { replace: true });
    dispatchSpy.mockRestore();
  });

  it('Layout renders Header, Sidebar, and outlet area', () => {
    const { getByText, getByRole } = render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Layout />
      </MemoryRouter>,
    );
    expect(getByText('MedFinance Analytics')).toBeInTheDocument();
    expect(getByRole('navigation', { name: 'Primary application navigation' })).toBeInTheDocument();
  });
});
