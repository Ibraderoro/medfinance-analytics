import { evaluateTenantIsolation, TenantScopedTable } from '../db/tenantIsolationVerifier';

const requiredPolicy = (tenantColumn: 'organization_id' | 'tenant_id') => ({
  name: 'tenant_isolation_required',
  command: 'ALL',
  roles: ['public'],
  usingExpression: `(${tenantColumn} = (current_setting('app.current_tenant_id'::text, true))::uuid)`,
  checkExpression: `(${tenantColumn} = (current_setting('app.current_tenant_id'::text, true))::uuid)`,
});

const table = (overrides: Partial<TenantScopedTable> = {}): TenantScopedTable => ({
  schema: 'public',
  table: 'transactions',
  tenantColumn: 'organization_id',
  rlsEnabled: true,
  forceRls: true,
  policies: [requiredPolicy('organization_id')],
  ...overrides,
});

describe('tenant isolation verifier', () => {
  it('passes when tenant-scoped tables have RLS, FORCE RLS, and required tenant policy', () => {
    const report = evaluateTenantIsolation([table()], '2026-08-06T00:00:00.000Z');

    expect(report.findings).toEqual([]);
    expect(report.tenantScopedTables).toHaveLength(1);
  });

  it('reports disabled RLS, missing FORCE RLS, and missing required policy', () => {
    const report = evaluateTenantIsolation([
      table({ rlsEnabled: false, forceRls: false, policies: [] }),
    ], '2026-08-06T00:00:00.000Z');

    expect(report.findings).toEqual([
      { severity: 'error', table: 'public.transactions', message: 'Row level security is disabled.' },
      { severity: 'error', table: 'public.transactions', message: 'FORCE ROW LEVEL SECURITY is missing.' },
      {
        severity: 'error',
        table: 'public.transactions',
        message: 'Required ALL tenant policy using organization_id and app.current_tenant_id is missing.',
      },
    ]);
  });

  it('accepts tenant_id scoped tables with the required current tenant policy', () => {
    const report = evaluateTenantIsolation([
      table({ table: 'audit_logs', tenantColumn: 'tenant_id', policies: [requiredPolicy('tenant_id')] }),
    ]);

    expect(report.findings).toEqual([]);
  });
});
