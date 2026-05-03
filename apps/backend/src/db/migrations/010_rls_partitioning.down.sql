DROP POLICY IF EXISTS transactions_tenant_rls ON transactions;
DROP POLICY IF EXISTS forecasts_tenant_rls ON forecasts;
DROP POLICY IF EXISTS compliance_items_tenant_rls ON compliance_items;
ALTER TABLE IF EXISTS transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS forecasts DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS compliance_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS api_request_metrics_archive DISABLE ROW LEVEL SECURITY;
DROP TABLE IF EXISTS api_request_metrics_archive;
