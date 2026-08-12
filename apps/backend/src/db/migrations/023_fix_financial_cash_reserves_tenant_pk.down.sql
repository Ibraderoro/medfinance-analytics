-- Rollback tenant-aware financial cash reserves migration

ALTER TABLE financial_cash_reserves
DROP CONSTRAINT IF EXISTS fk_financial_cash_reserves_organization;

ALTER TABLE financial_cash_reserves
DROP CONSTRAINT IF EXISTS financial_cash_reserves_pkey;

ALTER TABLE financial_cash_reserves
ADD CONSTRAINT financial_cash_reserves_pkey
PRIMARY KEY (month_start);

DROP INDEX IF EXISTS idx_financial_cash_reserves_organization;

ALTER TABLE financial_cash_reserves
DROP COLUMN IF EXISTS organization_id;
