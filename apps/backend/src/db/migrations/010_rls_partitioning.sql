ALTER TABLE IF EXISTS transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS forecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS compliance_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS transactions FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS forecasts FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS compliance_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transactions_tenant_rls ON transactions;
CREATE POLICY transactions_tenant_rls ON transactions
FOR ALL USING (organization_id = current_setting('app.current_tenant_id', true)::uuid)
WITH CHECK (organization_id = current_setting('app.current_tenant_id', true)::uuid);

DROP POLICY IF EXISTS forecasts_tenant_rls ON forecasts;
CREATE POLICY forecasts_tenant_rls ON forecasts
FOR ALL USING (organization_id = current_setting('app.current_tenant_id', true)::uuid)
WITH CHECK (organization_id = current_setting('app.current_tenant_id', true)::uuid);

DROP POLICY IF EXISTS compliance_items_tenant_rls ON compliance_items;
CREATE POLICY compliance_items_tenant_rls ON compliance_items
FOR ALL USING (organization_id = current_setting('app.current_tenant_id', true)::uuid)
WITH CHECK (organization_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS api_request_metrics_archive (LIKE api_request_metrics INCLUDING ALL);
