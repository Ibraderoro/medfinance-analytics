import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout/Layout';
import { DashboardPage } from './pages/Dashboard';
import { FinancialsPage } from './pages/Financials';
import { ForecastingPage } from './pages/Forecasting';
import { CompliancePage } from './pages/Compliance';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="financials" element={<FinancialsPage />} />
          <Route path="forecasting" element={<ForecastingPage />} />
          <Route path="compliance" element={<CompliancePage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
