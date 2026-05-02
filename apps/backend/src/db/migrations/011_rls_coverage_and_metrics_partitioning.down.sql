DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['financial_transactions','budgets','compliance_records','transactions','forecasts','compliance_items']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname=t) THEN
      EXECUTE format('DROP POLICY IF EXISTS %I_tenant_rls ON %I', t, t);
    END IF;
  END LOOP;
END $$;
DROP TABLE IF EXISTS api_request_metrics_archive CASCADE;
