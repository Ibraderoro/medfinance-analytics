-- Keep RLS enabled on rollback; remove only the policies introduced by this hardening migration.
DO $$
DECLARE
  tenant_table RECORD;
  policy_name TEXT;
BEGIN
  FOR tenant_table IN
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE c.relkind IN ('r', 'p')
      AND n.nspname = 'public'
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND a.attname IN ('organization_id', 'tenant_id')
    GROUP BY n.nspname, c.relname
  LOOP
    policy_name := tenant_table.table_name || '_tenant_isolation_required';
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', policy_name, tenant_table.schema_name, tenant_table.table_name);
  END LOOP;
END $$;
