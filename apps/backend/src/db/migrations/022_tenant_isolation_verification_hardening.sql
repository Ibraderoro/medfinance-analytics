-- Harden every tenant-scoped table for automated tenant isolation verification.
CREATE TABLE IF NOT EXISTS public.tenant_isolation_rls_state (
  schema_name TEXT NOT NULL,
  table_name TEXT NOT NULL,
  rls_enabled BOOLEAN NOT NULL,
  force_rls BOOLEAN NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (schema_name, table_name)
);

DO $$
DECLARE
  tenant_table RECORD;
  policy_name TEXT;
BEGIN
  FOR tenant_table IN
    SELECT schema_name, table_name, tenant_column, rls_enabled, force_rls
    FROM (
      SELECT
        n.nspname AS schema_name,
        c.relname AS table_name,
        a.attname AS tenant_column,
        c.relrowsecurity AS rls_enabled,
        c.relforcerowsecurity AS force_rls,
        row_number() OVER (
          PARTITION BY c.oid
          ORDER BY CASE a.attname WHEN 'organization_id' THEN 1 ELSE 2 END
        ) AS column_preference
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
      WHERE c.relkind IN ('r', 'p')
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname NOT LIKE 'pg_toast%'
        AND a.attnum > 0
        AND NOT a.attisdropped
        AND a.attname IN ('organization_id', 'tenant_id')
    ) discovered
    WHERE column_preference = 1
    ORDER BY schema_name, table_name
  LOOP
    policy_name := tenant_table.table_name || '_tenant_isolation_required';

    INSERT INTO public.tenant_isolation_rls_state (schema_name, table_name, rls_enabled, force_rls)
    VALUES (tenant_table.schema_name, tenant_table.table_name, tenant_table.rls_enabled, tenant_table.force_rls)
    ON CONFLICT (schema_name, table_name) DO UPDATE
      SET rls_enabled = EXCLUDED.rls_enabled,
          force_rls = EXCLUDED.force_rls,
          captured_at = NOW();

    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', tenant_table.schema_name, tenant_table.table_name);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', tenant_table.schema_name, tenant_table.table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', tenant_table.table_name || '_tenant_isolation', tenant_table.schema_name, tenant_table.table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', tenant_table.table_name || '_tenant_rls', tenant_table.schema_name, tenant_table.table_name);
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
