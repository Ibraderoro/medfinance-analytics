DO $$
DECLARE
  tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY[
    'departments',
    'forecasts',
    'transactions',
    'financial_cash_reserves',
    'compliance_items',
    'regulatory_alerts',
    'audit_log'
  ]
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = tenant_table
        AND column_name = 'organization_id'
    ) THEN
      EXECUTE format('DROP POLICY IF EXISTS %I_tenant_rls ON %I', tenant_table, tenant_table);
      EXECUTE format(
        'CREATE POLICY %I_tenant_rls ON %I FOR ALL USING (organization_id = current_setting(''app.current_tenant_id'', true)::uuid) WITH CHECK (organization_id = current_setting(''app.current_tenant_id'', true)::uuid)',
        tenant_table,
        tenant_table
      );
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tenant_table);
    END IF;
  END LOOP;
END $$;
