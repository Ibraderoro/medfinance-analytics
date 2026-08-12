sql
-- MedFinance Analytics core financial schema
-- Contains normalized tables used by backend analytics endpoints.
-- Multi-tenant version: organization_id is carried through all
-- organization-scoped financial entities.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- Departments
-- ============================================================================

CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  organization_id UUID NOT NULL
    REFERENCES organizations(id)
    ON DELETE CASCADE,

  department_code VARCHAR(24) NOT NULL,
  name VARCHAR(120) NOT NULL,
  cost_center VARCHAR(32) NOT NULL,
  parent_department_id UUID REFERENCES departments(id) ON DELETE SET NULL,

  status VARCHAR(16) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_departments_organization_code
    UNIQUE (organization_id, department_code),

  CONSTRAINT uq_departments_organization_cost_center
    UNIQUE (organization_id, cost_center)
);

-- ============================================================================
-- Forecasts
-- ============================================================================

CREATE TABLE IF NOT EXISTS forecasts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  organization_id UUID NOT NULL
    REFERENCES organizations(id)
    ON DELETE CASCADE,

  department_id UUID NOT NULL
    REFERENCES departments(id)
    ON DELETE CASCADE,

  fiscal_year INTEGER NOT NULL
    CHECK (fiscal_year BETWEEN 2000 AND 2100),

  fiscal_month INTEGER NOT NULL
    CHECK (fiscal_month BETWEEN 1 AND 12),

  metric_type VARCHAR(16) NOT NULL
    CHECK (metric_type IN ('revenue', 'expense')),

  projected_amount NUMERIC(16, 2) NOT NULL
    CHECK (projected_amount >= 0),

  scenario VARCHAR(24) NOT NULL DEFAULT 'baseline'
    CHECK (scenario IN ('baseline', 'best_case', 'worst_case')),

  confidence_score NUMERIC(5, 2)
    CHECK (confidence_score BETWEEN 0 AND 100),

  assumptions JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_forecasts_period
    UNIQUE (
      organization_id,
      department_id,
      fiscal_year,
      fiscal_month,
      metric_type,
      scenario
    )
);

-- ============================================================================
-- Transactions
-- ============================================================================

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  organization_id UUID NOT NULL
    REFERENCES organizations(id)
    ON DELETE CASCADE,

  department_id UUID NOT NULL
    REFERENCES departments(id)
    ON DELETE RESTRICT,

  forecast_id UUID
    REFERENCES forecasts(id)
    ON DELETE SET NULL,

  transaction_type VARCHAR(16) NOT NULL
    CHECK (transaction_type IN ('revenue', 'expense')),

  category VARCHAR(64) NOT NULL,
  vendor_name VARCHAR(160),
  invoice_number VARCHAR(64),
  description TEXT,

  amount NUMERIC(16, 2) NOT NULL
    CHECK (amount >= 0),

  tax_amount NUMERIC(16, 2) NOT NULL DEFAULT 0
    CHECK (tax_amount >= 0),

  currency CHAR(3) NOT NULL DEFAULT 'USD',

  occurred_on DATE NOT NULL,

  posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- Performance indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_departments_organization
  ON departments(organization_id);

CREATE INDEX IF NOT EXISTS idx_departments_parent
  ON departments(parent_department_id);

CREATE INDEX IF NOT EXISTS idx_departments_status
  ON departments(status);

CREATE INDEX IF NOT EXISTS idx_forecasts_organization_period
  ON forecasts(
    organization_id,
    fiscal_year,
    fiscal_month
  );

CREATE INDEX IF NOT EXISTS idx_forecasts_department_period
  ON forecasts(
    department_id,
    fiscal_year,
    fiscal_month
  );

CREATE INDEX IF NOT EXISTS idx_forecasts_metric_period
  ON forecasts(
    metric_type,
    fiscal_year,
    fiscal_month
  );

CREATE INDEX IF NOT EXISTS idx_transactions_organization_date
  ON transactions(
    organization_id,
    occurred_on DESC
  );

CREATE INDEX IF NOT EXISTS idx_transactions_occurred_on
  ON transactions(occurred_on DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_type_date
  ON transactions(
    transaction_type,
    occurred_on DESC
  );

CREATE INDEX IF NOT EXISTS idx_transactions_department_date
  ON transactions(
    department_id,
    occurred_on DESC
  );

CREATE INDEX IF NOT EXISTS idx_transactions_forecast_id
  ON transactions(forecast_id);

CREATE INDEX IF NOT EXISTS idx_transactions_category
  ON transactions(category);

-- ============================================================================
-- Financial KPI schema
-- ============================================================================

-- CREATE TABLE IF NOT EXISTS financial_cash_reserves (
--   organization_id UUID NOT NULL
--     REFERENCES organizations(id)
--     ON DELETE RESTRICT,

--   month_start DATE NOT NULL,

--   cash_reserve_amount NUMERIC(16, 2) NOT NULL DEFAULT 0
--     CHECK (cash_reserve_amount >= 0),

--   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
--   updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

--   CONSTRAINT financial_cash_reserves_pkey
--     PRIMARY KEY (organization_id, month_start)
-- );

-- CREATE INDEX IF NOT EXISTS idx_financial_cash_reserves_organization
--   ON financial_cash_reserves(organization_id);

-- CREATE INDEX IF NOT EXISTS idx_financial_cash_reserves_month
--   ON financial_cash_reserves(month_start);

-- ============================================================================
-- Dashboard query optimization
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_transactions_month_type
  ON transactions (
    (DATE_TRUNC('month', occurred_on::timestamp)),
    transaction_type
  )
  INCLUDE (amount, category);

-- ============================================================================
-- Financial KPI view
-- ============================================================================

CREATE OR REPLACE VIEW financial_kpis AS
WITH monthly_totals AS (
  SELECT
    t.organization_id,

    DATE_TRUNC(
      'month',
      t.occurred_on::timestamp
    )::date AS month_start,

    COALESCE(
      SUM(
        CASE
          WHEN t.transaction_type = 'revenue'
          THEN t.amount
          ELSE 0
        END
      ),
      0
    )::numeric(16, 2) AS total_revenue,

    COALESCE(
      SUM(
        CASE
          WHEN t.transaction_type = 'expense'
          THEN t.amount
          ELSE 0
        END
      ),
      0
    )::numeric(16, 2) AS total_expenses,

    COALESCE(
      SUM(
        CASE
          WHEN t.transaction_type = 'expense'
           AND t.category IN ('salaries', 'equipment')
          THEN t.amount
          ELSE 0
        END
      ),
      0
    )::numeric(16, 2) AS direct_costs

  FROM transactions t
  GROUP BY
    t.organization_id,
    DATE_TRUNC(
      'month',
      t.occurred_on::timestamp
    )::date
),

monthly_kpis AS (
  SELECT
    m.organization_id,
    m.month_start,

    m.total_revenue,
    m.total_expenses,

    COALESCE(
      m.total_revenue - m.total_expenses,
      0
    )::numeric(16, 2) AS net_income,

    COALESCE(
      ROUND(
        (
          (m.total_revenue - m.direct_costs)
          / NULLIF(m.total_revenue, 0)
        ) * 100,
        2
      ),
      0
    )::numeric(7, 2) AS gross_margin,

    COALESCE(
      ROUND(
        (
          (m.total_revenue - m.total_expenses)
          / NULLIF(m.total_revenue, 0)
        ) * 100,
        2
      ),
      0
    )::numeric(7, 2) AS operating_margin,

    COALESCE(
      GREATEST(
        m.total_expenses - m.total_revenue,
        0
      ),
      0
    )::numeric(16, 2) AS burn_rate

  FROM monthly_totals m
),

kpis_with_lags AS (
  SELECT
    k.*,

    LAG(k.total_revenue, 1)
      OVER (
        PARTITION BY k.organization_id
        ORDER BY k.month_start
      ) AS prev_month_revenue,

    LAG(k.total_revenue, 12)
      OVER (
        PARTITION BY k.organization_id
        ORDER BY k.month_start
      ) AS prev_year_revenue,

    LAG(k.net_income, 1)
      OVER (
        PARTITION BY k.organization_id
        ORDER BY k.month_start
      ) AS prev_month_net_income,

    LAG(k.net_income, 12)
      OVER (
        PARTITION BY k.organization_id
        ORDER BY k.month_start
      ) AS prev_year_net_income

  FROM monthly_kpis k
)

SELECT
  k.organization_id,

  k.month_start,

  EXTRACT(YEAR FROM k.month_start)::int
    AS fiscal_year,

  EXTRACT(MONTH FROM k.month_start)::int
    AS fiscal_month,

  COALESCE(k.total_revenue, 0)::numeric(16, 2)
    AS total_revenue,

  COALESCE(k.total_expenses, 0)::numeric(16, 2)
    AS total_expenses,

  COALESCE(k.net_income, 0)::numeric(16, 2)
    AS net_income,

  COALESCE(k.gross_margin, 0)::numeric(7, 2)
    AS gross_margin,

  COALESCE(k.operating_margin, 0)::numeric(7, 2)
    AS operating_margin,

  COALESCE(k.burn_rate, 0)::numeric(16, 2)
    AS burn_rate,

  COALESCE(
    r.cash_reserve_amount,
    0
  )::numeric(16, 2)
    AS cash_reserve_amount,

  COALESCE(
    ROUND(
      COALESCE(r.cash_reserve_amount, 0)
      / NULLIF(k.burn_rate, 0),
      2
    ),
    0
  )::numeric(12, 2)
    AS runway_months,

  COALESCE(
    ROUND(
      (
        (k.total_revenue - k.prev_month_revenue)
        / NULLIF(k.prev_month_revenue, 0)
      ) * 100,
      2
    ),
    0
  )::numeric(7, 2)
    AS revenue_mom_growth,

  COALESCE(
    ROUND(
      (
        (k.total_revenue - k.prev_year_revenue)
        / NULLIF(k.prev_year_revenue, 0)
      ) * 100,
      2
    ),
    0
  )::numeric(7, 2)
    AS revenue_yoy_growth,

  COALESCE(
    ROUND(
      (
        (k.net_income - k.prev_month_net_income)
        / NULLIF(k.prev_month_net_income, 0)
      ) * 100,
      2
    ),
    0
  )::numeric(7, 2)
    AS net_income_mom_growth,

  COALESCE(
    ROUND(
      (
        (k.net_income - k.prev_year_net_income)
        / NULLIF(k.prev_year_net_income, 0)
      ) * 100,
      2
    ),
    0
  )::numeric(7, 2)
    AS net_income_yoy_growth

FROM kpis_with_lags k

LEFT JOIN financial_cash_reserves r
  ON r.organization_id = k.organization_id
 AND r.month_start = k.month_start

ORDER BY
  k.organization_id,
  k.month_start;