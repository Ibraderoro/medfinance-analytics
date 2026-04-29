import { getPool } from '../config/database';

const REQUIRED_TABLES = [
  'schema_migrations',
  'users',
  'financial_records',
  'compliance_records',
  'financial_kpis',
  'tenants',
  'tenant_users',
  'api_keys',
  'audit_logs',
  'subscriptions',
  'payments',
  'invoices',
  'usage_events',
  'analytics_events',
  'analytics_rollups',
] as const;

export async function validateRequiredTables(): Promise<void> {
  const result = await getPool().query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'`,
  );

  const existingTables = new Set(result.rows.map((row) => row.table_name));
  const missingTables = REQUIRED_TABLES.filter((table) => !existingTables.has(table));

  if (missingTables.length > 0) {
    throw new Error(
      `Database schema validation failed. Missing required table(s): ${missingTables.join(', ')}`,
    );
  }
}

export { REQUIRED_TABLES };
