-- Migration 002: Add organization scoping, cost_center unique constraints, and composite FKs
BEGIN;

-- 1. Ensure organizations table exists and create fallback default organization
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO organizations (id, name)
VALUES (md5('default_organization')::uuid, 'Default Organization')
ON CONFLICT (id) DO NOTHING;

-- 2. Deterministic backfill of organization_id on legacy rows
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'departments' AND column_name = 'organization_id'
  ) THEN
    UPDATE departments 
    SET organization_id = md5('default_organization')::uuid 
    WHERE organization_id IS NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'forecasts' AND column_name = 'organization_id'
  ) THEN
    UPDATE forecasts 
    SET organization_id = md5('default_organization')::uuid 
    WHERE organization_id IS NULL;
  END IF;
END $$;

-- 3. Modify departments constraints
ALTER TABLE departments DROP CONSTRAINT IF EXISTS departments_cost_center_key;
ALTER TABLE departments DROP CONSTRAINT IF EXISTS uq_departments_org_cost_center;
ALTER TABLE departments ADD CONSTRAINT uq_departments_org_cost_center UNIQUE (organization_id, cost_center);

ALTER TABLE departments DROP CONSTRAINT IF EXISTS uq_departments_org_id;
ALTER TABLE departments ADD CONSTRAINT uq_departments_org_id UNIQUE (organization_id, id);

-- 4. Modify forecasts constraints
ALTER TABLE forecasts DROP CONSTRAINT IF EXISTS uq_forecasts_org_id;
ALTER TABLE forecasts ADD CONSTRAINT uq_forecasts_org_id UNIQUE (organization_id, id);

-- 5. Align index names
DROP INDEX IF EXISTS idx_transactions_organization_id;
CREATE INDEX IF NOT EXISTS idx_transactions_organization ON transactions(organization_id);

DROP INDEX IF EXISTS idx_forecasts_organization_id;
CREATE INDEX IF NOT EXISTS idx_forecasts_organization ON forecasts(organization_id);

DROP INDEX IF EXISTS idx_departments_organization_id;
CREATE INDEX IF NOT EXISTS idx_departments_organization ON departments(organization_id);

COMMIT;