-- Financial KPI schema additions for analytics-grade dashboards

CREATE TABLE IF NOT EXISTS financial_cash_reserves (
  month_start DATE PRIMARY KEY,
  cash_reserve_amount NUMERIC(16, 2) NOT NULL DEFAULT 0 CHECK (cash_reserve_amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Dashboard query optimization: index supporting month-based grouped scans.
CREATE INDEX IF NOT EXISTS idx_transactions_month_type
  ON transactions ((DATE_TRUNC('month', occurred_on::timestamp)), transaction_type)
  INCLUDE (amount, category);

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
