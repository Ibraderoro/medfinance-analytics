-- Migration 002: Add organization scoping, cost_center unique constraints, and composite FKs
BEGIN;

-- 1. Modify departments constraints
ALTER TABLE departments DROP CONSTRAINT IF EXISTS departments_cost_center_key;
ALTER TABLE departments ADD CONSTRAINT uq_departments_org_cost_center UNIQUE (organization_id, cost_center);
ALTER TABLE departments ADD CONSTRAINT uq_departments_org_id UNIQUE (organization_id, id);

-- 2. Modify forecasts constraints
ALTER TABLE forecasts ADD CONSTRAINT uq_forecasts_org_id UNIQUE (organization_id, id);

-- 3. Align index names
DROP INDEX IF EXISTS idx_transactions_organization_id;
CREATE INDEX IF NOT EXISTS idx_transactions_organization ON transactions(organization_id);

DROP INDEX IF EXISTS idx_forecasts_organization_id;
CREATE INDEX IF NOT EXISTS idx_forecasts_organization ON forecasts(organization_id);

DROP INDEX IF EXISTS idx_departments_organization_id;
CREATE INDEX IF NOT EXISTS idx_departments_organization ON departments(organization_id);

COMMIT;