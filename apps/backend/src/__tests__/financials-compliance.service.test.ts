const mockQuery = jest.fn();
const mockCacheGet = jest.fn();
const mockCacheSet = jest.fn();
const mockInvalidateFinancialCache = jest.fn();

jest.mock('../config/database', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

jest.mock('../config/redis', () => ({
  CACHE_TTL: { financialDataSeconds: 300 },
  invalidateFinancialCache: (...args: unknown[]) => mockInvalidateFinancialCache(...args),
}));

jest.mock('../utils/cache', () => ({
  CacheService: jest.fn().mockImplementation(() => ({
    get: (...args: unknown[]) => mockCacheGet(...args),
    set: (...args: unknown[]) => mockCacheSet(...args),
  })),
}));

import { ComplianceService } from '../services/compliance.service';
import { FinancialsService, invalidateOrganizationFinancialCache } from '../services/financials.service';

describe('FinancialsService production coverage', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockCacheGet.mockReset();
    mockCacheSet.mockReset();
    mockInvalidateFinancialCache.mockReset();
  });

  it('returns cached KPI and summary payloads without hitting Postgres', async () => {
    const service = new FinancialsService();
    mockCacheGet
      .mockResolvedValueOnce([{ fiscal_month: 1, revenue: 100 }])
      .mockResolvedValueOnce({ total_revenue: '100.00' });

    await expect(service.getKpis({ organizationId: 'org-1', year: 2026 })).resolves.toEqual([{ fiscal_month: 1, revenue: 100 }]);
    await expect(service.getSummary({ organizationId: 'org-1', year: 2026, period: 'monthly' })).resolves.toEqual({ total_revenue: '100.00' });

    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockCacheSet).not.toHaveBeenCalled();
  });

  it('queries and caches KPI and summary payloads on cache misses', async () => {
    const service = new FinancialsService();
    mockCacheGet.mockResolvedValue(undefined);
    mockQuery
      .mockResolvedValueOnce([{ fiscal_month: 1, revenue: '100.00' }])
      .mockResolvedValueOnce([{ total_revenue: '100.00', total_expenses: '40.00', net_income: '60.00' }]);

    const kpis = await service.getKpis({ organizationId: 'org-1', year: 2026 });
    const summary = await service.getSummary({ organizationId: 'org-1', year: 2026, period: 'monthly' });

    expect(kpis).toEqual([{ fiscal_month: 1, revenue: '100.00' }]);
    expect(summary).toEqual({ total_revenue: '100.00', total_expenses: '40.00', net_income: '60.00' });
    expect(mockQuery).toHaveBeenNthCalledWith(1, expect.stringContaining('FROM financial_kpis'), ['org-1', 2026]);
    expect(mockQuery).toHaveBeenNthCalledWith(2, expect.stringContaining('FROM transactions'), ['org-1', 2026]);
    expect(mockCacheSet).toHaveBeenCalledWith('kpis:org-1:2026', kpis);
    expect(mockCacheSet).toHaveBeenCalledWith('summary:org-1:2026', summary);
  });

  it('returns an empty summary object when Postgres returns no rows', async () => {
    const service = new FinancialsService();
    mockCacheGet.mockResolvedValue(undefined);
    mockQuery.mockResolvedValueOnce([]);

    await expect(service.getSummary({ organizationId: 'org-1', year: 2026, period: 'monthly' })).resolves.toEqual({});
    expect(mockCacheSet).toHaveBeenCalledWith('summary:org-1:2026', {});
  });

  it('queries revenue, expense, and cash-flow series with tenant and date-range parameters', async () => {
    const service = new FinancialsService();
    mockQuery
      .mockResolvedValueOnce([{ month: '2026-01-01', total: '10.00' }])
      .mockResolvedValueOnce([{ category: 'labor', total: '4.00' }])
      .mockResolvedValueOnce([{ month: '2026-01-01', net_cash_flow: '6.00' }]);

    await expect(service.getRevenue({ organizationId: 'org-1', startDate: '2026-01-01', endDate: '2026-01-31' })).resolves.toHaveLength(1);
    await expect(service.getExpenses({ organizationId: 'org-1' })).resolves.toHaveLength(1);
    await expect(service.getCashFlow({ organizationId: 'org-1', endDate: '2026-03-31' })).resolves.toHaveLength(1);

    expect(mockQuery).toHaveBeenNthCalledWith(1, expect.stringContaining("transaction_type = 'revenue'"), ['org-1', '2026-01-01', '2026-01-31']);
    expect(mockQuery).toHaveBeenNthCalledWith(2, expect.stringContaining("transaction_type = 'expense'"), ['org-1', null, null]);
    expect(mockQuery).toHaveBeenNthCalledWith(3, expect.stringContaining('net_cash_flow'), ['org-1', null, '2026-03-31']);
  });

  it('delegates organization financial cache invalidation to Redis', async () => {
    mockInvalidateFinancialCache.mockResolvedValue(undefined);

    await invalidateOrganizationFinancialCache('org-1');

    expect(mockInvalidateFinancialCache).toHaveBeenCalledWith('org-1');
  });
});

describe('ComplianceService production coverage', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('loads tenant-scoped compliance status rows', async () => {
    const service = new ComplianceService();
    mockQuery.mockResolvedValueOnce([{ regulation_code: 'HIPAA', status: 'ok' }]);

    await expect(service.getComplianceStatus('org-1')).resolves.toEqual([{ regulation_code: 'HIPAA', status: 'ok' }]);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('FROM compliance_items'), ['org-1']);
  });

  it('paginates tenant-scoped audit-log rows and parses total counts', async () => {
    const service = new ComplianceService();
    mockQuery
      .mockResolvedValueOnce([{ id: 'audit-1', action: 'login_success' }])
      .mockResolvedValueOnce([{ count: '17' }]);

    await expect(service.getAuditLog({ organizationId: 'org-1', page: 3, limit: 5 })).resolves.toEqual({
      items: [{ id: 'audit-1', action: 'login_success' }],
      total: 17,
      page: 3,
      limit: 5,
    });
    expect(mockQuery).toHaveBeenNthCalledWith(1, expect.stringContaining('LIMIT $2 OFFSET $3'), ['org-1', 5, 10]);
    expect(mockQuery).toHaveBeenNthCalledWith(2, expect.stringContaining('COUNT(*) AS count'), ['org-1']);
  });

  it('defaults audit-log totals to zero when the count query returns no row', async () => {
    const service = new ComplianceService();
    mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await expect(service.getAuditLog({ organizationId: 'org-1', page: 1, limit: 25 })).resolves.toMatchObject({
      items: [],
      total: 0,
    });
  });

  it('loads regulatory alerts with optional severity filters', async () => {
    const service = new ComplianceService();
    mockQuery
      .mockResolvedValueOnce([{ id: 'alert-1', severity: 'critical' }])
      .mockResolvedValueOnce([{ id: 'alert-2', severity: 'medium' }]);

    await expect(service.getRegulatoryAlerts({ organizationId: 'org-1', severity: 'critical' })).resolves.toHaveLength(1);
    await expect(service.getRegulatoryAlerts({ organizationId: 'org-1' })).resolves.toHaveLength(1);

    expect(mockQuery).toHaveBeenNthCalledWith(1, expect.stringContaining('FROM regulatory_alerts'), ['org-1', 'critical']);
    expect(mockQuery).toHaveBeenNthCalledWith(2, expect.stringContaining('FROM regulatory_alerts'), ['org-1', null]);
  });
});
