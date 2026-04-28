ALTER TABLE users DROP CONSTRAINT IF EXISTS fk_users_organization;
ALTER TABLE departments DROP CONSTRAINT IF EXISTS fk_departments_organization;
ALTER TABLE forecasts DROP CONSTRAINT IF EXISTS fk_forecasts_organization;
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS fk_transactions_organization;
ALTER TABLE financial_cash_reserves DROP CONSTRAINT IF EXISTS fk_financial_cash_reserves_organization;
ALTER TABLE compliance_items DROP CONSTRAINT IF EXISTS fk_compliance_items_organization;
ALTER TABLE regulatory_alerts DROP CONSTRAINT IF EXISTS fk_regulatory_alerts_organization;
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS fk_audit_log_organization;

DROP INDEX IF EXISTS idx_users_organization;
DROP INDEX IF EXISTS idx_departments_organization;
DROP INDEX IF EXISTS idx_forecasts_organization;
DROP INDEX IF EXISTS idx_transactions_organization;
DROP INDEX IF EXISTS idx_financial_cash_reserves_organization;
DROP INDEX IF EXISTS idx_compliance_items_organization;
DROP INDEX IF EXISTS idx_regulatory_alerts_organization;
DROP INDEX IF EXISTS idx_audit_log_organization;

ALTER TABLE users DROP COLUMN IF EXISTS organization_id;
ALTER TABLE departments DROP COLUMN IF EXISTS organization_id;
ALTER TABLE forecasts DROP COLUMN IF EXISTS organization_id;
ALTER TABLE transactions DROP COLUMN IF EXISTS organization_id;
ALTER TABLE financial_cash_reserves DROP COLUMN IF EXISTS organization_id;
ALTER TABLE compliance_items DROP COLUMN IF EXISTS organization_id;
ALTER TABLE regulatory_alerts DROP COLUMN IF EXISTS organization_id;
ALTER TABLE audit_log DROP COLUMN IF EXISTS organization_id;

DROP TABLE IF EXISTS organizations;
