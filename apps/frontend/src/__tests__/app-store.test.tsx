import { act, render, screen, waitFor } from '@testing-library/react';
import App from '../App';
import { useAppStore } from '../store';
import { authApi } from '../services/api';

jest.mock('../services/api', () => ({
  authApi: {
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

const refreshMock = authApi.refresh as jest.Mock;

describe('App routing and auth session coverage', () => {
  beforeEach(() => {
    refreshMock.mockReset();
    sessionStorage.clear();
    window.history.pushState({}, '', '/');
  });

  it('shows the login page when no session hint exists', async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByText('Login page')).toBeInTheDocument());
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('renders protected routes after a successful refresh', async () => {
    sessionStorage.setItem('auth_session_active', 'true');
    refreshMock.mockResolvedValueOnce({});
    window.history.pushState({}, '', '/dashboard');

    render(<App />);

    expect(screen.getByText('Checking secure session')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Protected shell')).toBeInTheDocument());
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('redirects authenticated login and unknown routes to the dashboard shell', async () => {
    sessionStorage.setItem('auth_session_active', 'true');
    refreshMock.mockResolvedValue({});
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

  it('clears the session and redirects to login when refresh fails', async () => {
    sessionStorage.setItem('auth_session_active', 'true');
    refreshMock.mockRejectedValueOnce(new Error('expired'));
    window.history.pushState({}, '', '/billing');

    render(<App />);

    await waitFor(() => expect(screen.getByText('Login page')).toBeInTheDocument());
    expect(sessionStorage.getItem('auth_session_active')).toBeNull();
  });

  it('revalidates when auth-session and storage events fire', async () => {
    sessionStorage.setItem('auth_session_active', 'true');
    refreshMock.mockResolvedValue({});
    window.history.pushState({}, '', '/financials');

    render(<App />);
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      window.dispatchEvent(new Event('auth-session-changed'));
    });
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(2));

    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'auth_session_active' }));
    });
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(3));
  });

  it('does not revalidate for unrelated storage keys', async () => {
    sessionStorage.setItem('auth_session_active', 'true');
    refreshMock.mockResolvedValue({});

    render(<App />);
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'other_key' }));
    });
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
