DO $$
DECLARE
  tenant_table RECORD;
  policy_name TEXT;
BEGIN
  IF to_regclass('public.tenant_isolation_rls_state') IS NULL THEN
    RAISE EXCEPTION 'Cannot roll back tenant isolation hardening: prior RLS state table is missing';
  END IF;

  FOR tenant_table IN
    SELECT s.schema_name, s.table_name, s.rls_enabled, s.force_rls
    FROM public.tenant_isolation_rls_state s
    JOIN pg_namespace n ON n.nspname = s.schema_name
    JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = s.table_name
    WHERE c.relkind IN ('r', 'p')
    ORDER BY s.schema_name, s.table_name
  LOOP
    policy_name := tenant_table.table_name || '_tenant_isolation_required';
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', policy_name, tenant_table.schema_name, tenant_table.table_name);

    IF tenant_table.rls_enabled THEN
      EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', tenant_table.schema_name, tenant_table.table_name);
    ELSE
      EXECUTE format('ALTER TABLE %I.%I DISABLE ROW LEVEL SECURITY', tenant_table.schema_name, tenant_table.table_name);
    END IF;

    IF tenant_table.force_rls THEN
      EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', tenant_table.schema_name, tenant_table.table_name);
    ELSE
      EXECUTE format('ALTER TABLE %I.%I NO FORCE ROW LEVEL SECURITY', tenant_table.schema_name, tenant_table.table_name);
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public.tenant_isolation_rls_state s
    LEFT JOIN pg_namespace n ON n.nspname = s.schema_name
    LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = s.table_name AND c.relkind IN ('r', 'p')
    WHERE c.oid IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot roll back tenant isolation hardening: one or more captured tenant tables no longer exist';
  END IF;

  DROP TABLE public.tenant_isolation_rls_state;
END $$;
