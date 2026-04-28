import { InsightsService } from '../services/insights.service';

jest.mock('../config/database', () => ({
  query: jest.fn(),
}));

import { query } from '../config/database';

const mockQuery = query as jest.Mock;

describe('InsightsService.getInsights', () => {
  const service = new InsightsService();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns high risk when no KPI history exists', async () => {
    mockQuery.mockResolvedValueOnce([]);

    const result = await service.getInsights('org-uuid');

    expect(result.health_score).toBe(0);
    expect(result.risk_level).toBe('high');
    expect(result.insights[0]).toContain('No financial history');
  });

  it('generates deterministic revenue trend and positive cash flow insights', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        month_start: '2026-04-01',
        total_revenue: '112000',
        total_expenses: '98000',
        net_income: '14000',
        burn_rate: '0',
        cash_reserve_amount: '250000',
        runway_months: '0',
      },
      {
        month_start: '2026-03-01',
        total_revenue: '104000',
        total_expenses: '97000',
        net_income: '7000',
        burn_rate: '0',
        cash_reserve_amount: '240000',
        runway_months: '0',
      },
    ]);

    const result = await service.getInsights('org-uuid');

    expect(result.insights.join(' ')).toContain('Revenue increased');
    expect(result.insights.join(' ')).toContain('Net cash flow is positive');
    expect(['low', 'medium']).toContain(result.risk_level);
  });

  it('detects expense anomaly and high risk for sustained negative cash flow', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        month_start: '2026-04-01',
        total_revenue: '90000',
        total_expenses: '130000',
        net_income: '-40000',
        burn_rate: '40000',
        cash_reserve_amount: '75000',
        runway_months: '1.88',
      },
      {
        month_start: '2026-03-01',
        total_revenue: '95000',
        total_expenses: '78000',
        net_income: '-17000',
        burn_rate: '0',
        cash_reserve_amount: '90000',
        runway_months: '0',
      },
      {
        month_start: '2026-02-01',
        total_revenue: '92000',
        total_expenses: '73000',
        net_income: '19000',
        burn_rate: '0',
        cash_reserve_amount: '93000',
        runway_months: '0',
      },
      {
        month_start: '2026-01-01',
        total_revenue: '91000',
        total_expenses: '72000',
        net_income: '19000',
        burn_rate: '0',
        cash_reserve_amount: '95000',
        runway_months: '0',
      },
      {
        month_start: '2025-12-01',
        total_revenue: '90500',
        total_expenses: '71000',
        net_income: '19500',
        burn_rate: '0',
        cash_reserve_amount: '98000',
        runway_months: '0',
      },
      {
        month_start: '2025-11-01',
        total_revenue: '89000',
        total_expenses: '123000',
        net_income: '-34000',
        burn_rate: '34000',
        cash_reserve_amount: '120000',
        runway_months: '3.52',
      },
    ]);

    const result = await service.getInsights('org-uuid');

    expect(result.risk_level).toBe('high');
    expect(result.insights.join(' ')).toContain('Expense anomaly detected');
    expect(result.insights.join(' ')).toContain('Negative cash flow warning');
    expect(result.insights.join(' ')).toContain('Negative cash flow occurred in at least 2 of the last 3 months');
    expect(result.insights.join(' ')).toContain('Critical liquidity warning');
  });
});
