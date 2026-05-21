DO $$
DECLARE
  tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY[
    'users',
    'departments',
    'forecasts',
    'transactions',
    'financial_cash_reserves',
    'compliance_items',
    'regulatory_alerts',
    'audit_log',
    'api_request_metrics',
    'api_request_metrics_archive'
  ]
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = tenant_table
    ) THEN
      EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', tenant_table);
    END IF;
  END LOOP;
END $$;

ALTER TABLE IF EXISTS public.audit_logs NO FORCE ROW LEVEL SECURITY;
