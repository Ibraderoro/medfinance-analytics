import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout/Layout';
import { DashboardPage } from './pages/Dashboard';
import { FinancialsPage } from './pages/Financials';
import { ForecastingPage } from './pages/Forecasting';
import { CompliancePage } from './pages/Compliance';
import { LoginPage } from './pages/Login';

function isAuthenticated(): boolean {
  return Boolean(localStorage.getItem('access_token'));
}

function ProtectedRoute({ children }: { children: JSX.Element }) {
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={isAuthenticated() ? <Navigate to="/dashboard" replace /> : <LoginPage />}
        />

        <Route
          path="/"
          element={(
            <ProtectedRoute>
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

        <Route path="*" element={<Navigate to={isAuthenticated() ? '/dashboard' : '/login'} replace />} />
      </Routes>
    </BrowserRouter>
  );
}
