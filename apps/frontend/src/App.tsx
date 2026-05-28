import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { Loading } from './components/common/Loading';
import { Layout } from './components/Layout/Layout';
import { DashboardPage } from './pages/Dashboard';
import { FinancialsPage } from './pages/Financials';
import { ForecastingPage } from './pages/Forecasting';
import { CompliancePage } from './pages/Compliance';
import { BillingPage } from './pages/Billing';
import { LoginPage } from './pages/Login';
import { RegisterPage } from './pages/Register';
import { AdminInvitesPage } from './pages/AdminInvites';
import { OidcCallbackPage } from './pages/OidcCallback';
import { authApi } from './services/api';

function useAuthSession() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    const validateSession = async () => {
      const hintedSession = sessionStorage.getItem('auth_session_active') === 'true';
      if (!hintedSession) {
        setIsAuthenticated(false);
        return;
      }

      try {
        await authApi.refresh();
        setIsAuthenticated(true);
      } catch {
        sessionStorage.removeItem('auth_session_active');
        setIsAuthenticated(false);
      }
    };


    const handleAuthSessionChanged = () => {
      void validateSession();
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'auth_session_active') {
        void validateSession();
      }
    };

    window.addEventListener('auth-session-changed', handleAuthSessionChanged);
    window.addEventListener('storage', handleStorage);

    void validateSession();

    return () => {
      window.removeEventListener('auth-session-changed', handleAuthSessionChanged);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  return isAuthenticated;
}


function useThemeMode() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const storedTheme = localStorage.getItem('theme_mode');
      return storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : 'light';
    } catch {
      return 'light';
    }
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('theme_mode', theme);
    } catch {}
  }, [theme]);

  return { theme, toggleTheme: () => setTheme((t) => (t === 'light' ? 'dark' : 'light')) };
}

function ProtectedRoute({ children, isAuthenticated }: { children: JSX.Element; isAuthenticated: boolean | null }) {
  if (isAuthenticated === null) {
    return <Loading message="Checking secure session" />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

export default function App() {
  const isAuthenticated = useAuthSession();
  const { theme, toggleTheme } = useThemeMode();

  return (
    <ErrorBoundary fallbackTitle="Application unavailable">
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route
          path="/login"
          element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <LoginPage />}
        />
        <Route
          path="/register"
          element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <RegisterPage />}
        />
        <Route
          path="/oidc/callback"
          element={<OidcCallbackPage />}
        />
        <Route
          path="/"
          element={(
            <ProtectedRoute isAuthenticated={isAuthenticated}>
              <Layout theme={theme} onToggleTheme={toggleTheme} />
            </ProtectedRoute>
          )}
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="financials" element={<FinancialsPage />} />
          <Route path="forecasting" element={<ForecastingPage />} />
          <Route path="compliance" element={<CompliancePage />} />
          <Route path="billing" element={<BillingPage />} />
          <Route path="admin/invitations" element={<AdminInvitesPage />} />
        </Route>

        <Route path="*" element={<Navigate to={isAuthenticated ? '/dashboard' : '/login'} replace />} />
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  );
}
