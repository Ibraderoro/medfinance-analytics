import { render, screen } from '@testing-library/react';
import { Dashboard } from '../components/Dashboard/Dashboard';
import { CompliancePage } from '../pages/Compliance';
import type { ComplianceItemRow } from '../hooks/useCompliance';

jest.mock('../components/Charts/RevenueChart', () => ({ RevenueChart: () => <div>Mock Revenue Chart</div> }));
jest.mock('../components/Charts/ForecastChart', () => ({ ForecastChart: () => <div>Mock Forecast Chart</div> }));
jest.mock('../components/Charts/ComplianceChart', () => ({ ComplianceChart: () => <div>Mock Compliance Chart</div> }));

const mockComplianceItems: ComplianceItemRow[] = [
  { regulation_code: 'HIPAA', status: 'non_compliant', last_reviewed_at: null, next_review_due_at: '2026-06-01', assigned_to: 'Owner' },
  { regulation_code: 'SOX', status: 'under_review', last_reviewed_at: null, next_review_due_at: '2026-07-01', assigned_to: 'Controller' },
  { regulation_code: 'HITRUST', status: 'compliant', last_reviewed_at: null, next_review_due_at: '2026-08-01', assigned_to: 'Auditor' },
];

const mockFinancialsState = { revenue: [], isLoading: false, error: null as Error | null };
const mockForecastingState = { forecast: [], isLoading: false, error: null as Error | null };
const mockFinancialKpisState = {
  latest: {
    total_revenue: 100000,
    total_expenses: 70000,
    net_income: 30000,
    operating_margin: 30,
    revenue_yoy_growth: 12.5,
    net_income_yoy_growth: -4.2,
  },
  error: null as Error | null,
};
const mockComplianceState = { isLoading: false, error: null as Error | null, items: mockComplianceItems };

jest.mock('../hooks/useFinancials', () => ({ useFinancials: () => mockFinancialsState }));
jest.mock('../hooks/useForecasting', () => ({ useForecasting: () => mockForecastingState }));
jest.mock('../hooks/useFinancialKpis', () => ({ useFinancialKpis: () => mockFinancialKpisState }));
jest.mock('../hooks/useCompliance', () => ({ useCompliance: () => mockComplianceState }));

describe('Dashboard KPIs and compliance rendering', () => {
  beforeEach(() => {
    mockFinancialsState.error = null;
    mockForecastingState.error = null;
    mockFinancialKpisState.error = null;
    mockComplianceState.error = null;
  });

  it('renders Revenue, Expenses, and Margin values with expected trend colors/icons', () => {
    // Failure Mode: KPI hook regressions can render stale or color-inverted financial indicators.
    render(<Dashboard />);

    expect(screen.getByText('Total Revenue')).toBeInTheDocument();
    expect(screen.getByText('$100,000')).toBeInTheDocument();
    expect(screen.getByText('Total Expenses')).toBeInTheDocument();
    expect(screen.getByText('$70,000')).toBeInTheDocument();
    expect(screen.getByText('Operating Margin')).toBeInTheDocument();
    expect(screen.getByText('30.0%')).toBeInTheDocument();

    expect(screen.getByText(/↑ \+12\.5%/)).toBeInTheDocument();
    expect(screen.getByText(/↓ -4\.2%/)).toBeInTheDocument();
  });

  it('shows a dashboard availability alert when financial data fails', () => {
    mockFinancialsState.error = new Error('financials unavailable');

    render(<Dashboard />);

    expect(screen.getByRole('alert')).toHaveTextContent('Dashboard temporarily unavailable. Please refresh.');
    expect(screen.getAllByText(/No Data Available/).length).toBeGreaterThan(0);
  });

  it('shows regulatory list entries and status badges for each severity state', () => {
    // Failure Mode: Compliance mapping bugs can drop high-priority items or assign incorrect visual priority.
    render(<CompliancePage />);

    expect(screen.getByText('HIPAA')).toBeInTheDocument();
    expect(screen.getByText('SOX')).toBeInTheDocument();
    expect(screen.getByText('HITRUST')).toBeInTheDocument();

    expect(screen.getByText('non compliant')).toBeInTheDocument();
    expect(screen.getByText('under review')).toBeInTheDocument();
    expect(screen.getByText('compliant')).toBeInTheDocument();
    expect(screen.getByText('Mock Compliance Chart')).toBeInTheDocument();
  });
});
