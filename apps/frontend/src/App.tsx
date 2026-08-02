import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
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
import { useAuthStore } from './store/authStore';
import { ProtectedRoute } from './components/routing/ProtectedRoute';
import { RoleRoute } from './components/routing/RoleRoute';

function useAuthBootstrap() {
  const restoreSession = useAuthStore((s) => s.restoreSession);
  const setNavigate = useAuthStore((s) => s.setNavigate);
  const navigate = useNavigate();

  useEffect(() => { void restoreSession(); }, [restoreSession]);
  useEffect(() => { setNavigate(navigate); return () => setNavigate(null); }, [navigate, setNavigate]);
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

function AppRoutes() {
  useAuthBootstrap();
  const { theme, toggleTheme } = useThemeMode();
  const status = useAuthStore((s) => s.status);
  const isAuthenticated = status === 'authenticated';
  const isChecking = status === 'idle' || status === 'checking';
  const checkingFallback = <Loading message="Checking secure session" />;

  return (
    <Routes>
      <Route
        path="/login"
        element={isChecking ? checkingFallback : isAuthenticated ? <Navigate to="/dashboard" replace /> : <LoginPage />}
      />
      <Route
        path="/register"
        element={isChecking ? checkingFallback : isAuthenticated ? <Navigate to="/dashboard" replace /> : <RegisterPage />}
      />
      <Route
        path="/oidc/callback"
        element={<OidcCallbackPage />}
      />
      <Route
        path="/"
        element={(
          <ProtectedRoute>
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
        <Route path="admin/invitations" element={<RoleRoute allow={['admin']}><AdminInvitesPage /></RoleRoute>} />
      </Route>

      <Route path="*" element={isChecking ? checkingFallback : <Navigate to={isAuthenticated ? '/dashboard' : '/login'} replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary fallbackTitle="Application unavailable">
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </ErrorBoundary>
  );
}
