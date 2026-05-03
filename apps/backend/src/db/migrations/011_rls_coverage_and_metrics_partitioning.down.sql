DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['financial_transactions','budgets','compliance_records','transactions','forecasts','compliance_items']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname=t AND n.nspname='public') THEN
      EXECUTE format('DROP POLICY IF EXISTS %I_tenant_rls ON %I', t, t);
      EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;
DROP TABLE IF EXISTS api_request_metrics_archive CASCADE;
DROP FUNCTION IF EXISTS ensure_api_metrics_archive_partition(date);
