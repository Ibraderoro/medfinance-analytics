import { discoverTenantScopedTables, evaluateTenantIsolation, TenantScopedTable } from '../db/tenantIsolationVerifier';

const requiredPolicy = (tenantColumn: 'organization_id' | 'tenant_id') => ({
  name: 'tenant_isolation_required',
  command: 'ALL',
  roles: ['public'],
  permissive: true,
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

  it('rejects permissive PUBLIC policies that do not enforce tenant equality', () => {
    const report = evaluateTenantIsolation([
      table({
        policies: [
          requiredPolicy('organization_id'),
          {
            name: 'broad_public_read',
            command: 'SELECT',
            roles: ['public'],
            permissive: true,
            usingExpression: 'true',
            checkExpression: null,
          },
        ],
      }),
    ]);

    expect(report.findings).toEqual([
      {
        severity: 'error',
        table: 'public.transactions',
        message: 'Required ALL tenant policy using organization_id and app.current_tenant_id is missing.',
      },
    ]);
  });

  it('rejects policies that mention tenant terms without required equality comparison', () => {
    const report = evaluateTenantIsolation([
      table({
        policies: [{
          name: 'contains_terms_without_equality',
          command: 'ALL',
          roles: ['app_user'],
          permissive: true,
          usingExpression: "organization_id IS NOT NULL OR current_setting('app.current_tenant_id'::text, true) IS NOT NULL",
          checkExpression: "organization_id IS NOT NULL OR current_setting('app.current_tenant_id'::text, true) IS NOT NULL",
        }],
      }),
    ]);

    expect(report.findings).toHaveLength(1);
  });

  it('maps pg_policy PUBLIC role OID 0 to a public policy role from catalog discovery', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [{
        schema: 'public',
        table: 'transactions',
        tenant_column: 'organization_id',
        rls_enabled: true,
        force_rls: true,
        policies: [{ ...requiredPolicy('organization_id'), roles: ['public'] }],
      }],
    });

    const tables = await discoverTenantScopedTables({ query } as never);

    expect(query.mock.calls[0][0]).toContain("WHEN policy_roles.role_oid = 0 THEN 'public'");
    expect(tables[0].policies[0].roles).toEqual(['public']);
  });
});
