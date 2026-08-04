import { act, render, screen, waitFor } from '@testing-library/react';
import App from '../App';
import { useAppStore } from '../store';
import { useAuthStore } from '../store/authStore';
import { authApi } from '../services/api';

jest.mock('../services/api', () => ({
  authApi: {
    getSession: jest.fn(),
    refresh: jest.fn(),
  },
}));

jest.mock('../components/Layout/Layout', () => ({
  Layout: () => <main><div>Protected shell</div></main>,
}));
jest.mock('../pages/Dashboard', () => ({ DashboardPage: () => <div>Dashboard page</div> }));
jest.mock('../pages/Financials', () => ({ FinancialsPage: () => <div>Financials page</div> }));
jest.mock('../pages/Forecasting', () => ({ ForecastingPage: () => <div>Forecasting page</div> }));
jest.mock('../pages/Compliance', () => ({ CompliancePage: () => <div>Compliance page</div> }));
jest.mock('../pages/Billing', () => ({ BillingPage: () => <div>Billing page</div> }));
jest.mock('../pages/Login', () => ({ LoginPage: () => <div>Login page</div> }));
jest.mock('../pages/Register', () => ({ RegisterPage: () => <div>Register page</div> }));

const getSessionMock = authApi.getSession as jest.Mock;
const refreshMock = authApi.refresh as jest.Mock;

const sessionResponse = {
  data: {
    data: {
      user: { id: 'user-1', email: 'a@b.com', firstName: 'A', lastName: 'B', role: 'admin', organizationId: 'org-1' },
    },
  },
};

function resetAuthStore() {
  useAuthStore.setState({
    status: 'idle',
    user: null,
    isRefreshing: false,
    sessionEndReason: null,
    hasCheckedSession: false,
    navigateRef: null,
  });
}

describe('App routing and auth session coverage', () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    refreshMock.mockReset();
    resetAuthStore();
    window.history.pushState({}, '', '/');
  });

  it('shows the login page when /auth/me and the fallback refresh both fail', async () => {
    getSessionMock.mockRejectedValueOnce({ response: { status: 401 } });
    refreshMock.mockRejectedValueOnce({ response: { status: 401 } });

    render(<App />);

    await waitFor(() => expect(screen.getByText('Login page')).toBeInTheDocument());
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('renders protected routes when /auth/me succeeds on first try', async () => {
    getSessionMock.mockResolvedValueOnce(sessionResponse);
    window.history.pushState({}, '', '/dashboard');

    render(<App />);

    expect(screen.getByText('Checking secure session')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Protected shell')).toBeInTheDocument());
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('redirects authenticated login and unknown routes to the dashboard shell', async () => {
    getSessionMock.mockResolvedValue(sessionResponse);
    window.history.pushState({}, '', '/login');

    const { rerender } = render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe('/dashboard'));

    act(() => {
      window.history.pushState({}, '', '/does-not-exist');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    rerender(<App />);
    await waitFor(() => expect(window.location.pathname).toBe('/dashboard'));
  });

  it('renders protected routes when /auth/me 401s but the fallback silent refresh succeeds', async () => {
    getSessionMock
      .mockRejectedValueOnce({ response: { status: 401 } })
      .mockResolvedValueOnce(sessionResponse);
    refreshMock.mockResolvedValueOnce({});
    window.history.pushState({}, '', '/billing');

    render(<App />);

    await waitFor(() => expect(screen.getByText('Protected shell')).toBeInTheDocument());
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});

describe('useAppStore', () => {
  it('updates selected year and organisation', () => {
    act(() => {
      useAppStore.getState().setSelectedYear(2027);
      useAppStore.getState().setSelectedOrganisation('org-123');
    });

    expect(useAppStore.getState().selectedYear).toBe(2027);
    expect(useAppStore.getState().selectedOrganisation).toBe('org-123');
  });
});
