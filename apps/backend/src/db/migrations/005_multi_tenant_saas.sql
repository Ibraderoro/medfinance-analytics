-- Multi-tenant SaaS upgrade

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure at least one tenant exists for backfilling existing single-tenant data.
INSERT INTO organizations (id, name)
VALUES (md5('default_organization')::uuid, 'Default Organization')
ON CONFLICT (id) DO NOTHING;

-- users table standardization and tenancy FK
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'organisation_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'organization_id'
  ) THEN
    ALTER TABLE users RENAME COLUMN organisation_id TO organization_id;
  END IF;
END$$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS organization_id UUID;

UPDATE users
SET organization_id = md5('default_organization')::uuid
WHERE organization_id IS NULL;

ALTER TABLE users
  ALTER COLUMN organization_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_organization') THEN
    ALTER TABLE users
      ADD CONSTRAINT fk_users_organization
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;
  END IF;
END$$;

DROP INDEX IF EXISTS idx_users_organisation;
CREATE INDEX IF NOT EXISTS idx_users_organization ON users(organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_organization_unique ON users(email, organization_id);

-- Tenant columns on financial and compliance tables
ALTER TABLE departments ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE forecasts ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE financial_cash_reserves ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE compliance_items ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE regulatory_alerts ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS organization_id UUID;

UPDATE departments SET organization_id = md5('default_organization')::uuid WHERE organization_id IS NULL;
UPDATE forecasts SET organization_id = md5('default_organization')::uuid WHERE organization_id IS NULL;
UPDATE transactions SET organization_id = md5('default_organization')::uuid WHERE organization_id IS NULL;
UPDATE financial_cash_reserves SET organization_id = md5('default_organization')::uuid WHERE organization_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'compliance_items' AND column_name = 'organisation_id'
  ) THEN
    EXECUTE 'UPDATE compliance_items SET organization_id = COALESCE(organization_id, organisation_id, md5(''default_organization'')::uuid)';
  ELSE
    UPDATE compliance_items SET organization_id = COALESCE(organization_id, md5('default_organization')::uuid);
  END IF;
END$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'regulatory_alerts' AND column_name = 'organisation_id'
  ) THEN
    EXECUTE 'UPDATE regulatory_alerts SET organization_id = COALESCE(organization_id, organisation_id, md5(''default_organization'')::uuid)';
  ELSE
    UPDATE regulatory_alerts SET organization_id = COALESCE(organization_id, md5('default_organization')::uuid);
  END IF;
END$$;
UPDATE audit_log SET organization_id = md5('default_organization')::uuid WHERE organization_id IS NULL;

ALTER TABLE departments ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE forecasts ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE transactions ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE financial_cash_reserves ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE compliance_items ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE regulatory_alerts ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE audit_log ALTER COLUMN organization_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_departments_organization') THEN
    ALTER TABLE departments
      ADD CONSTRAINT fk_departments_organization
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_forecasts_organization') THEN
    ALTER TABLE forecasts
      ADD CONSTRAINT fk_forecasts_organization
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_transactions_organization') THEN
    ALTER TABLE transactions
      ADD CONSTRAINT fk_transactions_organization
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_financial_cash_reserves_organization') THEN
    ALTER TABLE financial_cash_reserves
      ADD CONSTRAINT fk_financial_cash_reserves_organization
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_compliance_items_organization') THEN
    ALTER TABLE compliance_items
      ADD CONSTRAINT fk_compliance_items_organization
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_regulatory_alerts_organization') THEN
    ALTER TABLE regulatory_alerts
      ADD CONSTRAINT fk_regulatory_alerts_organization
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_audit_log_organization') THEN
    ALTER TABLE audit_log
      ADD CONSTRAINT fk_audit_log_organization
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;
  END IF;
END$$;

DROP INDEX IF EXISTS idx_compliance_items_org;
DROP INDEX IF EXISTS idx_regulatory_alerts_org;

CREATE INDEX IF NOT EXISTS idx_departments_organization ON departments(organization_id);
CREATE INDEX IF NOT EXISTS idx_forecasts_organization ON forecasts(organization_id);
CREATE INDEX IF NOT EXISTS idx_transactions_organization ON transactions(organization_id);
CREATE INDEX IF NOT EXISTS idx_financial_cash_reserves_organization ON financial_cash_reserves(organization_id);
CREATE INDEX IF NOT EXISTS idx_compliance_items_organization ON compliance_items(organization_id);
CREATE INDEX IF NOT EXISTS idx_regulatory_alerts_organization ON regulatory_alerts(organization_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_organization ON audit_log(organization_id);

-- Rebuild KPI view so every row is tenant-scoped.
CREATE OR REPLACE VIEW financial_kpis AS
WITH monthly_totals AS (
  SELECT
    t.organization_id,
    DATE_TRUNC('month', t.occurred_on::timestamp)::date AS month_start,
    COALESCE(SUM(CASE WHEN t.transaction_type = 'revenue' THEN t.amount ELSE 0 END), 0)::numeric(16, 2) AS total_revenue,
    COALESCE(SUM(CASE WHEN t.transaction_type = 'expense' THEN t.amount ELSE 0 END), 0)::numeric(16, 2) AS total_expenses,
    COALESCE(SUM(CASE WHEN t.transaction_type = 'expense' AND t.category IN ('salaries', 'equipment') THEN t.amount ELSE 0 END), 0)::numeric(16, 2) AS direct_costs
  FROM transactions t
  GROUP BY t.organization_id, 2
),
monthly_kpis AS (
  SELECT
    m.organization_id,
    m.month_start,
    COALESCE(m.total_revenue, 0)::numeric(16, 2) AS total_revenue,
    COALESCE(m.total_expenses, 0)::numeric(16, 2) AS total_expenses,
    COALESCE(m.total_revenue - m.total_expenses, 0)::numeric(16, 2) AS net_income,
    COALESCE(ROUND(((m.total_revenue - m.direct_costs) / NULLIF(m.total_revenue, 0)) * 100, 2), 0)::numeric(7, 2) AS gross_margin,
    COALESCE(ROUND(((m.total_revenue - m.total_expenses) / NULLIF(m.total_revenue, 0)) * 100, 2), 0)::numeric(7, 2) AS operating_margin,
    COALESCE(GREATEST(m.total_expenses - m.total_revenue, 0), 0)::numeric(16, 2) AS burn_rate
  FROM monthly_totals m
),
kpis_with_lags AS (
  SELECT
    k.*,
    LAG(k.total_revenue, 1) OVER (PARTITION BY k.organization_id ORDER BY k.month_start) AS prev_month_revenue,
    LAG(k.total_revenue, 12) OVER (PARTITION BY k.organization_id ORDER BY k.month_start) AS prev_year_revenue,
    LAG(k.net_income, 1) OVER (PARTITION BY k.organization_id ORDER BY k.month_start) AS prev_month_net_income,
    LAG(k.net_income, 12) OVER (PARTITION BY k.organization_id ORDER BY k.month_start) AS prev_year_net_income
  FROM monthly_kpis k
)
SELECT
  k.organization_id,
  k.month_start,
  EXTRACT(YEAR FROM k.month_start)::int AS fiscal_year,
  EXTRACT(MONTH FROM k.month_start)::int AS fiscal_month,
  COALESCE(k.total_revenue, 0)::numeric(16, 2) AS total_revenue,
  COALESCE(k.total_expenses, 0)::numeric(16, 2) AS total_expenses,
  COALESCE(k.net_income, 0)::numeric(16, 2) AS net_income,
  COALESCE(k.gross_margin, 0)::numeric(7, 2) AS gross_margin,
  COALESCE(k.operating_margin, 0)::numeric(7, 2) AS operating_margin,
  COALESCE(k.burn_rate, 0)::numeric(16, 2) AS burn_rate,
  COALESCE(r.cash_reserve_amount, 0)::numeric(16, 2) AS cash_reserve_amount,
  COALESCE(ROUND(COALESCE(r.cash_reserve_amount, 0) / NULLIF(k.burn_rate, 0), 2), 0)::numeric(12, 2) AS runway_months,
  COALESCE(ROUND(((k.total_revenue - k.prev_month_revenue) / NULLIF(k.prev_month_revenue, 0)) * 100, 2), 0)::numeric(7, 2) AS revenue_mom_growth,
  COALESCE(ROUND(((k.total_revenue - k.prev_year_revenue) / NULLIF(k.prev_year_revenue, 0)) * 100, 2), 0)::numeric(7, 2) AS revenue_yoy_growth,
  COALESCE(ROUND(((k.net_income - k.prev_month_net_income) / NULLIF(k.prev_month_net_income, 0)) * 100, 2), 0)::numeric(7, 2) AS net_income_mom_growth,
  COALESCE(ROUND(((k.net_income - k.prev_year_net_income) / NULLIF(k.prev_year_net_income, 0)) * 100, 2), 0)::numeric(7, 2) AS net_income_yoy_growth
FROM kpis_with_lags k
LEFT JOIN financial_cash_reserves r
  ON r.organization_id = k.organization_id
 AND r.month_start = k.month_start
ORDER BY k.organization_id, k.month_start;

-- Enforce tenant isolation in Postgres itself with RLS (defense-in-depth against app bugs).
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE forecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_cash_reserves ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE regulatory_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_tenant_isolation ON users;
CREATE POLICY users_tenant_isolation ON users
  FOR ALL
  USING (organization_id = current_setting('current_user.organization_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('current_user.organization_id', true)::uuid);

DROP POLICY IF EXISTS departments_tenant_isolation ON departments;
CREATE POLICY departments_tenant_isolation ON departments
  FOR ALL
  USING (organization_id = current_setting('current_user.organization_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('current_user.organization_id', true)::uuid);

DROP POLICY IF EXISTS forecasts_tenant_isolation ON forecasts;
CREATE POLICY forecasts_tenant_isolation ON forecasts
  FOR ALL
  USING (organization_id = current_setting('current_user.organization_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('current_user.organization_id', true)::uuid);

DROP POLICY IF EXISTS transactions_tenant_isolation ON transactions;
CREATE POLICY transactions_tenant_isolation ON transactions
  FOR ALL
  USING (organization_id = current_setting('current_user.organization_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('current_user.organization_id', true)::uuid);

DROP POLICY IF EXISTS financial_cash_reserves_tenant_isolation ON financial_cash_reserves;
CREATE POLICY financial_cash_reserves_tenant_isolation ON financial_cash_reserves
  FOR ALL
  USING (organization_id = current_setting('current_user.organization_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('current_user.organization_id', true)::uuid);

DROP POLICY IF EXISTS compliance_items_tenant_isolation ON compliance_items;
CREATE POLICY compliance_items_tenant_isolation ON compliance_items
  FOR ALL
  USING (organization_id = current_setting('current_user.organization_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('current_user.organization_id', true)::uuid);

DROP POLICY IF EXISTS regulatory_alerts_tenant_isolation ON regulatory_alerts;
CREATE POLICY regulatory_alerts_tenant_isolation ON regulatory_alerts
  FOR ALL
  USING (organization_id = current_setting('current_user.organization_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('current_user.organization_id', true)::uuid);

DROP POLICY IF EXISTS audit_log_tenant_isolation ON audit_log;
CREATE POLICY audit_log_tenant_isolation ON audit_log
  FOR ALL
  USING (organization_id = current_setting('current_user.organization_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('current_user.organization_id', true)::uuid);
