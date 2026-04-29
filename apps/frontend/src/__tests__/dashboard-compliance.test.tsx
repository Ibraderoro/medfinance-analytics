import { render, screen } from '@testing-library/react';
import { CompliancePage } from '../pages/Compliance';

jest.mock('../components/Charts/ComplianceChart', () => ({ ComplianceChart: () => <div>Mock Compliance Chart</div> }));
jest.mock('../hooks/useCompliance', () => ({ useCompliance: () => ({ isLoading: false, error: null, items: [{ regulation_code: 'HIPAA', status: 'non_compliant', next_review_due_at: '2026-06-01', assigned_to: 'Owner' }] }) }));

describe('Compliance tracker', () => {
  it('renders compliance status and chart', () => {
    render(<CompliancePage />);
    expect(screen.getByText('HIPAA')).toBeInTheDocument();
    expect(screen.getByText('non compliant')).toBeInTheDocument();
    expect(screen.getByText('Mock Compliance Chart')).toBeInTheDocument();
  });
});
