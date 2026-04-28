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
    expect(result.insights[0]).toContain('No KPI history');
  });

  it('generates deterministic trend insights based on latest and prior month data', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        month_start: '2026-04-01',
        total_revenue: '112000',
        total_expenses: '98000',
        net_income: '14000',
        burn_rate: '0',
        cash_reserve_amount: '250000',
        runway_months: '0',
        revenue_mom_growth: '7.69',
      },
      {
        month_start: '2026-03-01',
        total_revenue: '104000',
        total_expenses: '97000',
        net_income: '7000',
        burn_rate: '0',
        cash_reserve_amount: '240000',
        runway_months: '0',
        revenue_mom_growth: '0',
      },
    ]);

    const result = await service.getInsights('org-uuid');

    expect(result.insights.join(' ')).toContain('Revenue increased');
    expect(result.insights.join(' ')).toContain('Revenue growth is outpacing expense growth');
    expect(result.insights.join(' ')).toContain('Net income is positive');
    expect(['low', 'medium']).toContain(result.risk_level);
  });

  it('sets high risk when runway is below six months and losses repeat', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        month_start: '2026-04-01',
        total_revenue: '90000',
        total_expenses: '108000',
        net_income: '-18000',
        burn_rate: '18000',
        cash_reserve_amount: '85000',
        runway_months: '4.72',
        revenue_mom_growth: '-6.25',
      },
      {
        month_start: '2026-03-01',
        total_revenue: '96000',
        total_expenses: '111000',
        net_income: '-15000',
        burn_rate: '15000',
        cash_reserve_amount: '98000',
        runway_months: '6.53',
        revenue_mom_growth: '-4.00',
      },
      {
        month_start: '2026-02-01',
        total_revenue: '100000',
        total_expenses: '105000',
        net_income: '-5000',
        burn_rate: '5000',
        cash_reserve_amount: '110000',
        runway_months: '22.00',
        revenue_mom_growth: '0',
      },
    ]);

    const result = await service.getInsights('org-uuid');

    expect(result.risk_level).toBe('high');
    expect(result.insights.join(' ')).toContain('Cash runway is 4.7 months (high risk');
    expect(result.insights.join(' ')).toContain('losses in at least 2 of the last 3 months');
  });
});
