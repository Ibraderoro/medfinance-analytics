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

    const result = await service.getInsights();

    expect(result.health_score).toBe(0);
    expect(result.risk_level).toBe('high');
    expect(result.insights[0]).toContain('No KPI history');
  });

  it('flags medium/high risk when latest expense ratio is elevated', async () => {
    mockQuery.mockResolvedValueOnce([
      { month_start: '2026-04-01', total_revenue: '100000', total_expenses: '90000', net_income: '10000' },
      { month_start: '2026-03-01', total_revenue: '110000', total_expenses: '70000', net_income: '40000' },
      { month_start: '2026-02-01', total_revenue: '108000', total_expenses: '68000', net_income: '40000' },
      { month_start: '2026-01-01', total_revenue: '105000', total_expenses: '66000', net_income: '39000' },
    ]);

    const result = await service.getInsights();

    expect(result.health_score).toBeGreaterThanOrEqual(0);
    expect(result.health_score).toBeLessThanOrEqual(100);
    expect(['medium', 'high']).toContain(result.risk_level);
    expect(result.insights.join(' ')).toContain('Risk flag: high expenses');
  });

  it('detects negative trend with repeated revenue declines', async () => {
    mockQuery.mockResolvedValueOnce([
      { month_start: '2026-04-01', total_revenue: '90000', total_expenses: '91000', net_income: '-1000' },
      { month_start: '2026-03-01', total_revenue: '96000', total_expenses: '97000', net_income: '-1000' },
      { month_start: '2026-02-01', total_revenue: '102000', total_expenses: '98000', net_income: '4000' },
      { month_start: '2026-01-01', total_revenue: '108000', total_expenses: '99000', net_income: '9000' },
    ]);

    const result = await service.getInsights();

    expect(result.insights.join(' ')).toContain('Risk flag: negative trend');
    expect(['medium', 'high']).toContain(result.risk_level);
  });
});
