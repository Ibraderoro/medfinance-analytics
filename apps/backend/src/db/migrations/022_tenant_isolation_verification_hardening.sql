-- Harden every tenant-scoped table for automated tenant isolation verification.
DO $$
DECLARE
  tenant_table RECORD;
  policy_name TEXT;
BEGIN
  FOR tenant_table IN
    SELECT schema_name, table_name, tenant_column
    FROM (
      SELECT
        n.nspname AS schema_name,
        c.relname AS table_name,
        a.attname AS tenant_column,
        row_number() OVER (
          PARTITION BY c.oid
          ORDER BY CASE a.attname WHEN 'organization_id' THEN 1 ELSE 2 END
        ) AS column_preference
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
      WHERE c.relkind IN ('r', 'p')
        AND n.nspname = 'public'
        AND a.attnum > 0
        AND NOT a.attisdropped
        AND a.attname IN ('organization_id', 'tenant_id')
    ) discovered
    WHERE column_preference = 1
    ORDER BY schema_name, table_name
  LOOP
    policy_name := tenant_table.table_name || '_tenant_isolation_required';

    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', tenant_table.schema_name, tenant_table.table_name);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', tenant_table.schema_name, tenant_table.table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', policy_name, tenant_table.schema_name, tenant_table.table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I.%I FOR ALL USING (%I = current_setting(''app.current_tenant_id'', true)::uuid) WITH CHECK (%I = current_setting(''app.current_tenant_id'', true)::uuid)',
      policy_name,
      tenant_table.schema_name,
      tenant_table.table_name,
      tenant_table.tenant_column,
      tenant_table.tenant_column
    );
  END LOOP;
END $$;
