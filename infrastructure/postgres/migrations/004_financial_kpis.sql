-- MedFinance Analytics
-- Migration 004: Financial KPI schema
--
-- Adds organization-scoped cash reserves and the financial_kpis view.
--
-- IMPORTANT:
-- financial_cash_reserves is intentionally keyed by:
--   (organization_id, month_start)
--
-- This prevents different organizations from sharing the same month's
-- cash reserve and supports:
--
--   ON CONFLICT (organization_id, month_start)
--
-- used by the E2E seed data.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO organizations (id, name)
VALUES (
  md5('default_organization')::uuid,
  'Default Organization'
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 1. Financial cash reserves
-- ============================================================================

CREATE TABLE IF NOT EXISTS financial_cash_reserves (
  organization_id UUID NOT NULL
    REFERENCES organizations(id)
    ON DELETE RESTRICT,

  month_start DATE NOT NULL,

  cash_reserve_amount NUMERIC(16, 2)
    NOT NULL DEFAULT 0
    CHECK (cash_reserve_amount >= 0),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================================
-- 2. Normalize legacy primary key
--
-- Older versions of the schema used:
--
--   PRIMARY KEY (month_start)
--
-- That is incorrect for a multi-tenant application because two
-- organizations must be able to have the same month.
--
-- Normalize the table to:
--
--   PRIMARY KEY (organization_id, month_start)
--
-- The operation is safe for a fresh E2E database and also handles the
-- legacy schema.
-- ============================================================================

DO $$
DECLARE
  existing_pk_name TEXT;
BEGIN
  SELECT conname
  INTO existing_pk_name
  FROM pg_constraint
  WHERE conrelid = 'financial_cash_reserves'::regclass
    AND contype = 'p';

  IF existing_pk_name IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint c
      WHERE c.conrelid = 'financial_cash_reserves'::regclass
        AND c.contype = 'p'
        AND c.conkey = ARRAY[
          (
            SELECT attnum
            FROM pg_attribute
            WHERE attrelid = 'financial_cash_reserves'::regclass
              AND attname = 'organization_id'
          ),
          (
            SELECT attnum
            FROM pg_attribute
            WHERE attrelid = 'financial_cash_reserves'::regclass
              AND attname = 'month_start'
          )
        ]::smallint[]
    ) THEN
      EXECUTE format(
        'ALTER TABLE financial_cash_reserves DROP CONSTRAINT %I',
        existing_pk_name
      );
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'financial_cash_reserves'::regclass
      AND conname = 'financial_cash_reserves_pkey'
      AND contype = 'p'
  ) THEN
    ALTER TABLE financial_cash_reserves
      ADD CONSTRAINT financial_cash_reserves_pkey
      PRIMARY KEY (organization_id, month_start);
  END IF;
END
$$;


-- ============================================================================
-- 3. Supporting index
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_financial_cash_reserves_organization
  ON financial_cash_reserves (organization_id);

CREATE INDEX IF NOT EXISTS idx_financial_cash_reserves_month
  ON financial_cash_reserves (month_start);


-- ============================================================================
-- 4. Dashboard query optimization
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_transactions_month_type
  ON transactions (
    (DATE_TRUNC('month', occurred_on::timestamp)),
    transaction_type
  )
  INCLUDE (amount, category);


-- ============================================================================
-- 5. Financial KPI view
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

    COALESCE(m.total_revenue, 0)::numeric(16, 2) AS total_revenue,
    COALESCE(m.total_expenses, 0)::numeric(16, 2) AS total_expenses,

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
  EXTRACT(YEAR FROM k.month_start)::int AS fiscal_year,
  EXTRACT(MONTH FROM k.month_start)::int AS fiscal_month,
  COALESCE(k.total_revenue, 0)::numeric(16, 2) AS total_revenue,
  COALESCE(k.total_expenses, 0)::numeric(16, 2) AS total_expenses,
  COALESCE(k.net_income, 0)::numeric(16, 2) AS net_income,
  COALESCE(k.gross_margin, 0)::numeric(7, 2) AS gross_margin,
  COALESCE(k.operating_margin, 0)::numeric(7, 2) AS operating_margin,
  COALESCE(k.burn_rate, 0)::numeric(16, 2) AS burn_rate,
  COALESCE(r.cash_reserve_amount, 0)::numeric(16, 2) AS cash_reserve_amount,
  COALESCE(
    ROUND(
      COALESCE(r.cash_reserve_amount, 0)
      / NULLIF(k.burn_rate, 0),
      2
    ),
    0
  )::numeric(12, 2) AS runway_months,
  COALESCE(
    ROUND(
      ((k.total_revenue - k.prev_month_revenue)
        / NULLIF(k.prev_month_revenue, 0)) * 100,
      2
    ),
    0
  )::numeric(7, 2) AS revenue_mom_growth,
  COALESCE(
    ROUND(
      ((k.total_revenue - k.prev_year_revenue)
        / NULLIF(k.prev_year_revenue, 0)) * 100,
      2
    ),
    0
  )::numeric(7, 2) AS revenue_yoy_growth,
  COALESCE(
    ROUND(
      ((k.net_income - k.prev_month_net_income)
        / NULLIF(k.prev_month_net_income, 0)) * 100,
      2
    ),
    0
  )::numeric(7, 2) AS net_income_mom_growth,
  COALESCE(
    ROUND(
      ((k.net_income - k.prev_year_net_income)
        / NULLIF(k.prev_year_net_income, 0)) * 100,
      2
    ),
    0
  )::numeric(7, 2) AS net_income_yoy_growth
FROM kpis_with_lags k
LEFT JOIN financial_cash_reserves r
  ON r.organization_id = k.organization_id
 AND r.month_start = k.month_start
ORDER BY k.organization_id, k.month_start;