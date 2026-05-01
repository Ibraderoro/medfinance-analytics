import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Layout } from './components/Layout/Layout';
import { DashboardPage } from './pages/Dashboard';
import { FinancialsPage } from './pages/Financials';
import { ForecastingPage } from './pages/Forecasting';
import { CompliancePage } from './pages/Compliance';
import { LoginPage } from './pages/Login';
import { RegisterPage } from './pages/Register';
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

    void validateSession();
  }, []);

  return isAuthenticated;
}

function ProtectedRoute({ children, isAuthenticated }: { children: JSX.Element; isAuthenticated: boolean | null }) {
  if (isAuthenticated === null) {
    return <div style={{ padding: '2rem' }}>Checking secure session…</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

export default function App() {
  const isAuthenticated = useAuthSession();

  return (
    <BrowserRouter>
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
          path="/"
          element={(
            <ProtectedRoute isAuthenticated={isAuthenticated}>
              <Layout />
            </ProtectedRoute>
          )}
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="financials" element={<FinancialsPage />} />
          <Route path="forecasting" element={<ForecastingPage />} />
          <Route path="compliance" element={<CompliancePage />} />
        </Route>

        <Route path="*" element={<Navigate to={isAuthenticated ? '/dashboard' : '/login'} replace />} />
      </Routes>
    </BrowserRouter>
  );
}
