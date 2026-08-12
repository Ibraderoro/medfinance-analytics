-- Make financial_cash_reserves tenant-aware

ALTER TABLE financial_cash_reserves
ADD COLUMN IF NOT EXISTS organization_id UUID;

UPDATE financial_cash_reserves
SET organization_id = md5('default_organization')::uuid
WHERE organization_id IS NULL;

ALTER TABLE financial_cash_reserves
ALTER COLUMN organization_id SET NOT NULL;

DO $$
DECLARE
    existing_pk TEXT;
BEGIN
    SELECT conname
    INTO existing_pk
    FROM pg_constraint
    WHERE conrelid = 'financial_cash_reserves'::regclass
      AND contype = 'p';

    IF existing_pk IS NOT NULL THEN
        EXECUTE format(
            'ALTER TABLE financial_cash_reserves DROP CONSTRAINT %I',
            existing_pk
        );
    END IF;
END $$;

ALTER TABLE financial_cash_reserves
ADD CONSTRAINT financial_cash_reserves_pkey
PRIMARY KEY (organization_id, month_start);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname =
            'fk_financial_cash_reserves_organization'
    ) THEN
        ALTER TABLE financial_cash_reserves
        ADD CONSTRAINT fk_financial_cash_reserves_organization
        FOREIGN KEY (organization_id)
        REFERENCES organizations(id)
        ON DELETE RESTRICT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS
idx_financial_cash_reserves_organization
ON financial_cash_reserves (organization_id);