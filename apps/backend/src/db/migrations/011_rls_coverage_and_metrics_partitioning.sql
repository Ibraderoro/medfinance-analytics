DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['financial_transactions','budgets','compliance_records','transactions','forecasts','compliance_items']
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='organization_id') THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS %I_tenant_rls ON %I', t, t);
      EXECUTE format('CREATE POLICY %I_tenant_rls ON %I FOR ALL USING (organization_id = current_setting(''app.current_tenant_id'', true)::uuid) WITH CHECK (organization_id = current_setting(''app.current_tenant_id'', true)::uuid)', t, t);
    END IF;
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS api_request_metrics_archive (
  LIKE api_request_metrics INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS api_request_metrics_archive_default PARTITION OF api_request_metrics_archive DEFAULT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relname='api_request_metrics_archive_2026_01' AND n.nspname='public'
  ) THEN
    CREATE TABLE api_request_metrics_archive_2026_01 PARTITION OF api_request_metrics_archive
      FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
  END IF;
END $$;
