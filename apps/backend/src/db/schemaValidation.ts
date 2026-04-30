import { getPool } from '../config/database';

const REQUIRED_TABLES = [
  'schema_migrations',
  'users',
  'departments',
  'forecasts',
  'transactions',
  'compliance_items',
  'audit_log',
  'regulatory_alerts',
  'financial_cash_reserves',
  'organizations',
  'customers',
  'subscriptions',
  'api_request_metrics',
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
