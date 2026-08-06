import fs from 'fs';
import path from 'path';
import { Pool, PoolClient } from 'pg';

export type TenantScopedTable = {
  schema: string;
  table: string;
  tenantColumn: 'organization_id' | 'tenant_id';
  rlsEnabled: boolean;
  forceRls: boolean;
  policies: TenantPolicy[];
};

export type TenantPolicy = {
  name: string;
  command: string;
  roles: string[];
  usingExpression: string | null;
  checkExpression: string | null;
};

export type TenantIsolationFinding = {
  severity: 'error';
  table: string;
  message: string;
};

export type TenantIsolationReport = {
  generatedAt: string;
  tenantScopedTables: TenantScopedTable[];
  findings: TenantIsolationFinding[];
};

type Queryable = Pool | PoolClient;

const TENANT_COLUMN_CANDIDATES = ['organization_id', 'tenant_id'] as const;
const DEFAULT_REPORT_PATH = path.resolve(process.cwd(), 'tenant-isolation-report.json');

function qualifiedName(table: Pick<TenantScopedTable, 'schema' | 'table'>): string {
  return `${table.schema}.${table.table}`;
}

function normalizeExpression(expression: string | null): string {
  return (expression ?? '').replace(/\s+/g, ' ').toLowerCase();
}

function expressionMatchesTenantColumn(expression: string | null, tenantColumn: string): boolean {
  const normalized = normalizeExpression(expression);
  return normalized.includes(tenantColumn.toLowerCase())
    && normalized.includes("current_setting('app.current_tenant_id'::text, true)");
}

function hasRequiredTenantPolicy(table: TenantScopedTable): boolean {
  return table.policies.some((policy) => {
    const commandSupportsAllWrites = policy.command === 'ALL';
    return commandSupportsAllWrites
      && expressionMatchesTenantColumn(policy.usingExpression, table.tenantColumn)
      && expressionMatchesTenantColumn(policy.checkExpression, table.tenantColumn);
  });
}

export function evaluateTenantIsolation(tables: TenantScopedTable[], generatedAt = new Date().toISOString()): TenantIsolationReport {
  const findings: TenantIsolationFinding[] = [];

  for (const table of tables) {
    const tableName = qualifiedName(table);
    if (!table.rlsEnabled) {
      findings.push({ severity: 'error', table: tableName, message: 'Row level security is disabled.' });
    }
    if (!table.forceRls) {
      findings.push({ severity: 'error', table: tableName, message: 'FORCE ROW LEVEL SECURITY is missing.' });
    }
    if (!hasRequiredTenantPolicy(table)) {
      findings.push({
        severity: 'error',
        table: tableName,
        message: `Required ALL tenant policy using ${table.tenantColumn} and app.current_tenant_id is missing.`,
      });
    }
  }

  return { generatedAt, tenantScopedTables: tables, findings };
}

export async function discoverTenantScopedTables(client: Queryable): Promise<TenantScopedTable[]> {
  const result = await client.query<{
    schema: string;
    table: string;
    tenant_column: 'organization_id' | 'tenant_id';
    rls_enabled: boolean;
    force_rls: boolean;
    policies: TenantPolicy[] | null;
  }>(`
    WITH tenant_columns AS (
      SELECT
        n.nspname AS schema,
        c.relname AS table,
        a.attname AS tenant_column,
        c.relrowsecurity AS rls_enabled,
        c.relforcerowsecurity AS force_rls,
        c.oid AS table_oid,
        row_number() OVER (
          PARTITION BY c.oid
          ORDER BY CASE a.attname WHEN 'organization_id' THEN 1 WHEN 'tenant_id' THEN 2 ELSE 3 END
        ) AS column_preference
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
      WHERE c.relkind IN ('r', 'p')
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname NOT LIKE 'pg_toast%'
        AND a.attnum > 0
        AND NOT a.attisdropped
        AND a.attname = ANY($1::text[])
    )
    SELECT
      tc.schema,
      tc.table,
      tc.tenant_column,
      tc.rls_enabled,
      tc.force_rls,
      COALESCE(
        json_agg(
          json_build_object(
            'name', p.polname,
            'command', CASE p.polcmd WHEN '*' THEN 'ALL' WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' END,
            'roles', (SELECT array_agg(rolname ORDER BY rolname) FROM pg_roles WHERE oid = ANY(p.polroles)),
            'usingExpression', pg_get_expr(p.polqual, p.polrelid),
            'checkExpression', pg_get_expr(p.polwithcheck, p.polrelid)
          ) ORDER BY p.polname
        ) FILTER (WHERE p.oid IS NOT NULL),
        '[]'::json
      ) AS policies
    FROM tenant_columns tc
    LEFT JOIN pg_policy p ON p.polrelid = tc.table_oid
    WHERE tc.column_preference = 1
    GROUP BY tc.schema, tc.table, tc.tenant_column, tc.rls_enabled, tc.force_rls
    ORDER BY tc.schema, tc.table
  `, [TENANT_COLUMN_CANDIDATES]);

  return result.rows.map((row) => ({
    schema: row.schema,
    table: row.table,
    tenantColumn: row.tenant_column,
    rlsEnabled: row.rls_enabled,
    forceRls: row.force_rls,
    policies: row.policies ?? [],
  }));
}

export function writeTenantIsolationReport(report: TenantIsolationReport, reportPath = process.env.TENANT_ISOLATION_REPORT_PATH ?? DEFAULT_REPORT_PATH): void {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

export async function verifyTenantIsolation(client: Queryable, options: { writeReport?: boolean; reportPath?: string } = {}): Promise<TenantIsolationReport> {
  const tables = await discoverTenantScopedTables(client);
  const report = evaluateTenantIsolation(tables);

  if (options.writeReport ?? true) {
    writeTenantIsolationReport(report, options.reportPath);
  }

  if (report.findings.length > 0) {
    const details = report.findings.map((finding) => `${finding.table}: ${finding.message}`).join('\n');
    throw new Error(`Tenant isolation verification failed:\n${details}`);
  }

  return report;
}
