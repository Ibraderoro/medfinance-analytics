-- Rollback tenant-aware financial cash reserves migration

DO $$
BEGIN
  IF (SELECT count(*) FROM financial_cash_reserves) > 0
     AND (
       (SELECT count(DISTINCT organization_id) FROM financial_cash_reserves) > 1
       OR EXISTS (
         SELECT 1
         FROM financial_cash_reserves
         GROUP BY month_start
         HAVING count(*) > 1
       )
     ) THEN
    RAISE EXCEPTION
      'Unsafe rollback: financial_cash_reserves contains multiple organizations or tenant-specific rows; schema was left unchanged';
  END IF;
END $$;

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
