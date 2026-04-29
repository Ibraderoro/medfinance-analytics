-- Roll back RLS tenant isolation policies
DROP POLICY IF EXISTS users_tenant_isolation ON users;
DROP POLICY IF EXISTS departments_tenant_isolation ON departments;
DROP POLICY IF EXISTS forecasts_tenant_isolation ON forecasts;
DROP POLICY IF EXISTS transactions_tenant_isolation ON transactions;
DROP POLICY IF EXISTS financial_cash_reserves_tenant_isolation ON financial_cash_reserves;
DROP POLICY IF EXISTS compliance_items_tenant_isolation ON compliance_items;
DROP POLICY IF EXISTS regulatory_alerts_tenant_isolation ON regulatory_alerts;
DROP POLICY IF EXISTS audit_log_tenant_isolation ON audit_log;

ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE departments DISABLE ROW LEVEL SECURITY;
ALTER TABLE forecasts DISABLE ROW LEVEL SECURITY;
ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE financial_cash_reserves DISABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE regulatory_alerts DISABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log DISABLE ROW LEVEL SECURITY;

-- Restore non-tenant KPI view shape from migration 004
CREATE OR REPLACE VIEW financial_kpis AS
WITH monthly_totals AS (
  SELECT
    DATE_TRUNC('month', t.occurred_on::timestamp)::date AS month_start,
    COALESCE(SUM(CASE WHEN t.transaction_type = 'revenue' THEN t.amount ELSE 0 END), 0)::numeric(16, 2) AS total_revenue,
    COALESCE(SUM(CASE WHEN t.transaction_type = 'expense' THEN t.amount ELSE 0 END), 0)::numeric(16, 2) AS total_expenses,
    COALESCE(SUM(CASE WHEN t.transaction_type = 'expense' AND t.category IN ('salaries', 'equipment') THEN t.amount ELSE 0 END), 0)::numeric(16, 2) AS direct_costs
  FROM transactions t
  GROUP BY 1
),
monthly_kpis AS (
  SELECT
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
    LAG(k.total_revenue, 1) OVER (ORDER BY k.month_start) AS prev_month_revenue,
    LAG(k.total_revenue, 12) OVER (ORDER BY k.month_start) AS prev_year_revenue,
    LAG(k.net_income, 1) OVER (ORDER BY k.month_start) AS prev_month_net_income,
    LAG(k.net_income, 12) OVER (ORDER BY k.month_start) AS prev_year_net_income
  FROM monthly_kpis k
)
SELECT
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
LEFT JOIN financial_cash_reserves r ON r.month_start = k.month_start
ORDER BY k.month_start;

ALTER TABLE users DROP CONSTRAINT IF EXISTS fk_users_organization;
ALTER TABLE departments DROP CONSTRAINT IF EXISTS fk_departments_organization;
ALTER TABLE forecasts DROP CONSTRAINT IF EXISTS fk_forecasts_organization;
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS fk_transactions_organization;
ALTER TABLE financial_cash_reserves DROP CONSTRAINT IF EXISTS fk_financial_cash_reserves_organization;
ALTER TABLE compliance_items DROP CONSTRAINT IF EXISTS fk_compliance_items_organization;
ALTER TABLE regulatory_alerts DROP CONSTRAINT IF EXISTS fk_regulatory_alerts_organization;
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS fk_audit_log_organization;

DROP INDEX IF EXISTS idx_users_email_organization_unique;
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

-- Restore original spelling from migrations 002 and 003
ALTER TABLE users ADD COLUMN IF NOT EXISTS organisation_id UUID;
ALTER TABLE compliance_items ADD COLUMN IF NOT EXISTS organisation_id UUID;
ALTER TABLE regulatory_alerts ADD COLUMN IF NOT EXISTS organisation_id UUID;

CREATE INDEX IF NOT EXISTS idx_users_organisation ON users(organisation_id);
CREATE INDEX IF NOT EXISTS idx_compliance_items_org ON compliance_items(organisation_id);
CREATE INDEX IF NOT EXISTS idx_regulatory_alerts_org ON regulatory_alerts(organisation_id);

DROP TABLE IF EXISTS organizations;
