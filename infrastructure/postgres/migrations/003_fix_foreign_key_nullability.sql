-- Migration 003: Correct parent department organization scoping and forecast foreign key nullability
BEGIN;

-- 1. Fix transactions forecast FK (allow forecast_id NULL without affecting organization_id)
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_organization_id_forecast_id_fkey;
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS fk_transactions_forecast_org;
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS fk_transactions_forecast;

ALTER TABLE transactions 
  ADD CONSTRAINT fk_transactions_forecast 
  FOREIGN KEY (forecast_id) REFERENCES forecasts(id) 
  ON DELETE SET NULL;

-- 2. Fix parent department organization scoping
ALTER TABLE departments DROP CONSTRAINT IF EXISTS departments_parent_department_id_fkey;
ALTER TABLE departments DROP CONSTRAINT IF EXISTS fk_departments_parent_org;

ALTER TABLE departments 
  ADD CONSTRAINT fk_departments_parent_org 
  FOREIGN KEY (organization_id, parent_department_id) 
  REFERENCES departments(organization_id, id) 
  ON DELETE SET NULL;

COMMIT;