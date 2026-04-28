-- =============================================================================
-- MedFinance Analytics — Production Seed
-- =============================================================================
-- Idempotent: safe to run multiple times.
--
-- Departments  → ON CONFLICT (department_code) DO NOTHING
-- Forecasts    → ON CONFLICT (department_id, fiscal_year, fiscal_month,
--                              metric_type, scenario) DO NOTHING
-- Transactions → deterministic UUID via md5()::uuid + ON CONFLICT (id) DO NOTHING
--
-- Covers fiscal years 2024 – 2026 (36 months).
--
-- Seasonal revenue multipliers  : Q1 +15 %, Q2  –5 %, Q3 –10 %, Q4 +10 %
-- Seasonal expense multipliers  : Q1  –5 %, Q2  +5 %, Q3 +10 %, Q4  –5 %
-- Year-over-year growth          : +4 % per year compounded from 2024
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- 1. Departments
-- ---------------------------------------------------------------------------
INSERT INTO departments (id, department_code, name, cost_center, status)
VALUES
  -- Revenue-generating departments
  (md5('dept_outpatient_services')::uuid,   'OPC-001', 'Outpatient Services',    'CC-OPC-001', 'active'),
  (md5('dept_insurance_billing')::uuid,     'INS-002', 'Insurance & Billing',    'CC-INS-002', 'active'),
  (md5('dept_laboratory_services')::uuid,   'LAB-003', 'Laboratory Services',    'CC-LAB-003', 'active'),
  (md5('dept_pharmacy')::uuid,              'PHM-004', 'Pharmacy',               'CC-PHM-004', 'active'),
  -- Expense / cost departments
  (md5('dept_human_resources')::uuid,       'HRS-005', 'Human Resources',        'CC-HRS-005', 'active'),
  (md5('dept_facilities_management')::uuid, 'FAC-006', 'Facilities Management',  'CC-FAC-006', 'active'),
  (md5('dept_technology_equipment')::uuid,  'TEC-007', 'Technology & Equipment', 'CC-TEC-007', 'active'),
  (md5('dept_compliance_risk')::uuid,       'CPL-008', 'Compliance & Risk',      'CC-CPL-008', 'active')
ON CONFLICT (department_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Revenue transactions
--    Categories: consultations | insurance_claims | lab_services | pharmacy_sales
--
--    Base monthly amounts (USD):
--      consultations    : 480,000
--      insurance_claims : 320,000
--      lab_services     : 145,000
--      pharmacy_sales   : 210,000
-- ---------------------------------------------------------------------------
INSERT INTO transactions (
  id, department_id, transaction_type, category,
  invoice_number, description,
  amount, tax_amount, currency, occurred_on
)
SELECT
  md5('txn_rev_' || rev.category || '_' || yr::text || '_' || lpad(mo::text, 2, '0'))::uuid,
  (SELECT d.id FROM departments d WHERE d.department_code = rev.dept_code),
  'revenue',
  rev.category,
  'INV-REV-' || rev.cat_code || '-' || yr::text || '-' || lpad(mo::text, 2, '0'),
  initcap(replace(rev.category, '_', ' ')) || ' revenue — '
    || to_char(make_date(yr, mo, 1), 'FMMonth YYYY'),
  ROUND(
    (rev.base_amount::numeric
      * CASE
          WHEN mo IN (1,2,3)   THEN 1.15
          WHEN mo IN (4,5,6)   THEN 0.95
          WHEN mo IN (7,8,9)   THEN 0.90
          ELSE                      1.10
        END
      * POWER(1.04::numeric, (yr - 2024)::numeric)
    ),
    2
  ),
  0.00,
  'USD',
  (make_date(yr, mo, 1) + INTERVAL '14 days')::date
FROM
  generate_series(2024, 2026) AS yr,
  generate_series(1, 12)      AS mo,
  (VALUES
    ('OPC-001', 'consultations',    'CONS', 480000.00),
    ('INS-002', 'insurance_claims', 'INSC', 320000.00),
    ('LAB-003', 'lab_services',     'LABS', 145000.00),
    ('PHM-004', 'pharmacy_sales',   'PHMS', 210000.00)
  ) AS rev(dept_code, category, cat_code, base_amount)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Expense transactions
--    Categories: salaries | equipment | rent | utilities | compliance_costs
--
--    Base monthly amounts (USD):
--      salaries         : 520,000
--      equipment        :  85,000
--      rent             :  65,000
--      utilities        :  28,000
--      compliance_costs :  42,000
-- ---------------------------------------------------------------------------
INSERT INTO transactions (
  id, department_id, transaction_type, category,
  invoice_number, description,
  amount, tax_amount, currency, occurred_on
)
SELECT
  md5('txn_exp_' || exp.category || '_' || yr::text || '_' || lpad(mo::text, 2, '0'))::uuid,
  (SELECT d.id FROM departments d WHERE d.department_code = exp.dept_code),
  'expense',
  exp.category,
  'INV-EXP-' || exp.cat_code || '-' || yr::text || '-' || lpad(mo::text, 2, '0'),
  initcap(replace(exp.category, '_', ' ')) || ' expense — '
    || to_char(make_date(yr, mo, 1), 'FMMonth YYYY'),
  ROUND(
    (exp.base_amount::numeric
      * CASE
          WHEN mo IN (1,2,3)   THEN 0.95
          WHEN mo IN (4,5,6)   THEN 1.05
          WHEN mo IN (7,8,9)   THEN 1.10
          ELSE                      0.95
        END
      * POWER(1.04::numeric, (yr - 2024)::numeric)
    ),
    2
  ),
  ROUND(
    (exp.base_amount::numeric
      * CASE
          WHEN mo IN (1,2,3)   THEN 0.95
          WHEN mo IN (4,5,6)   THEN 1.05
          WHEN mo IN (7,8,9)   THEN 1.10
          ELSE                      0.95
        END
      * POWER(1.04::numeric, (yr - 2024)::numeric)
      * 0.08  -- 8 % applicable tax on expenses
    ),
    2
  ),
  'USD',
  (make_date(yr, mo, 1) + INTERVAL '28 days')::date
FROM
  generate_series(2024, 2026) AS yr,
  generate_series(1, 12)      AS mo,
  (VALUES
    ('HRS-005', 'salaries',         'SAL', 520000.00),
    ('TEC-007', 'equipment',        'EQP',  85000.00),
    ('FAC-006', 'rent',             'RNT',  65000.00),
    ('FAC-006', 'utilities',        'UTL',  28000.00),
    ('CPL-008', 'compliance_costs', 'CPL',  42000.00)
  ) AS exp(dept_code, category, cat_code, base_amount)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Baseline forecasts — revenue
--    One row per department × year × month
-- ---------------------------------------------------------------------------
INSERT INTO forecasts (
  id, department_id,
  fiscal_year, fiscal_month,
  metric_type, projected_amount,
  scenario, confidence_score, assumptions
)
SELECT
  md5('fcast_rev_' || dept_code || '_' || yr::text || '_' || lpad(mo::text, 2, '0'))::uuid,
  (SELECT d.id FROM departments d WHERE d.department_code = dept_code),
  yr, mo,
  'revenue',
  ROUND(
    (base_amount::numeric
      * CASE
          WHEN mo IN (1,2,3)   THEN 1.15
          WHEN mo IN (4,5,6)   THEN 0.95
          WHEN mo IN (7,8,9)   THEN 0.90
          ELSE                      1.10
        END
      * POWER(1.04::numeric, (yr - 2024)::numeric)
    ),
    2
  ),
  'baseline',
  85.00,
  jsonb_build_object(
    'seasonal_adjustment', CASE
      WHEN mo IN (1,2,3)   THEN '+15%'
      WHEN mo IN (4,5,6)   THEN '-5%'
      WHEN mo IN (7,8,9)   THEN '-10%'
      ELSE                      '+10%'
    END,
    'yoy_growth_rate', '4%',
    'seeded', true
  )
FROM
  generate_series(2024, 2026) AS yr,
  generate_series(1, 12)      AS mo,
  (VALUES
    ('OPC-001', 480000.00),
    ('INS-002', 320000.00),
    ('LAB-003', 145000.00),
    ('PHM-004', 210000.00)
  ) AS rev_depts(dept_code, base_amount)
ON CONFLICT (department_id, fiscal_year, fiscal_month, metric_type, scenario) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Baseline forecasts — expenses
-- ---------------------------------------------------------------------------
INSERT INTO forecasts (
  id, department_id,
  fiscal_year, fiscal_month,
  metric_type, projected_amount,
  scenario, confidence_score, assumptions
)
SELECT
  md5('fcast_exp_' || dept_code || '_' || yr::text || '_' || lpad(mo::text, 2, '0'))::uuid,
  (SELECT d.id FROM departments d WHERE d.department_code = dept_code),
  yr, mo,
  'expense',
  ROUND(
    (base_amount::numeric
      * CASE
          WHEN mo IN (1,2,3)   THEN 0.95
          WHEN mo IN (4,5,6)   THEN 1.05
          WHEN mo IN (7,8,9)   THEN 1.10
          ELSE                      0.95
        END
      * POWER(1.04::numeric, (yr - 2024)::numeric)
    ),
    2
  ),
  'baseline',
  88.00,
  jsonb_build_object(
    'seasonal_adjustment', CASE
      WHEN mo IN (1,2,3)   THEN '-5%'
      WHEN mo IN (4,5,6)   THEN '+5%'
      WHEN mo IN (7,8,9)   THEN '+10%'
      ELSE                      '-5%'
    END,
    'yoy_growth_rate', '4%',
    'seeded', true
  )
FROM
  generate_series(2024, 2026) AS yr,
  generate_series(1, 12)      AS mo,
  (VALUES
    ('HRS-005', 520000.00),
    ('TEC-007',  85000.00),
    ('FAC-006',  93000.00),  -- combined rent + utilities for this department
    ('CPL-008',  42000.00)
  ) AS exp_depts(dept_code, base_amount)
ON CONFLICT (department_id, fiscal_year, fiscal_month, metric_type, scenario) DO NOTHING;


-- ---------------------------------------------------------------------------
-- 6. Compliance sample data
-- ---------------------------------------------------------------------------
INSERT INTO compliance_items (
  id, regulation_code, status, last_reviewed_at, next_review_due_at, assigned_to, organisation_id
)
VALUES
  (md5('cmp_item_hipaa_164_312_a_1')::uuid, 'HIPAA-164.312(a)(1)', 'compliant', NOW() - INTERVAL '21 days', NOW() + INTERVAL '69 days', 'security.lead@medfinance.test', md5('org_medfinance_demo')::uuid),
  (md5('cmp_item_soc2_cc6_1')::uuid, 'SOC2-CC6.1', 'under_review', NOW() - INTERVAL '45 days', NOW() + INTERVAL '15 days', 'audit.manager@medfinance.test', md5('org_medfinance_demo')::uuid),
  (md5('cmp_item_hitrust_09_m')::uuid, 'HITRUST-09.m', 'non_compliant', NOW() - INTERVAL '90 days', NOW() + INTERVAL '7 days', 'risk.owner@medfinance.test', md5('org_medfinance_demo')::uuid)
ON CONFLICT (id) DO NOTHING;

INSERT INTO regulatory_alerts (
  id, title, description, severity, regulation_code, due_date, status, organisation_id
)
VALUES
  (md5('alert_hipaa_access_review')::uuid, 'Quarterly access review due', 'Access certification package for privileged users is due this quarter.', 'high', 'HIPAA-164.308(a)(4)', CURRENT_DATE + INTERVAL '30 days', 'open', md5('org_medfinance_demo')::uuid),
  (md5('alert_soc2_change_mgmt')::uuid, 'Change management evidence needed', 'Provide SOC 2 change tickets and approvals for production releases.', 'medium', 'SOC2-CC8.1', CURRENT_DATE + INTERVAL '21 days', 'acknowledged', md5('org_medfinance_demo')::uuid)
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- =============================================================================
-- 6. Convenience views  (financials_revenue / financials_expenses)
-- =============================================================================

CREATE OR REPLACE VIEW financials_revenue AS
SELECT
  t.id,
  t.department_id,
  d.name                                           AS department_name,
  t.category,
  t.invoice_number,
  t.description,
  t.amount,
  t.currency,
  t.occurred_on,
  EXTRACT(YEAR  FROM t.occurred_on)::INTEGER       AS fiscal_year,
  EXTRACT(MONTH FROM t.occurred_on)::INTEGER       AS fiscal_month,
  t.created_at
FROM transactions t
JOIN departments  d ON d.id = t.department_id
WHERE t.transaction_type = 'revenue';

CREATE OR REPLACE VIEW financials_expenses AS
SELECT
  t.id,
  t.department_id,
  d.name                                           AS department_name,
  t.category,
  t.invoice_number,
  t.description,
  t.amount,
  t.tax_amount,
  t.currency,
  t.occurred_on,
  EXTRACT(YEAR  FROM t.occurred_on)::INTEGER       AS fiscal_year,
  EXTRACT(MONTH FROM t.occurred_on)::INTEGER       AS fiscal_month,
  t.created_at
FROM transactions t
JOIN departments  d ON d.id = t.department_id
WHERE t.transaction_type = 'expense';

-- =============================================================================
-- 7. Materialized summary view  (monthly P&L + per-category breakdown)
-- =============================================================================
DROP MATERIALIZED VIEW IF EXISTS mv_monthly_financial_summary;

CREATE MATERIALIZED VIEW mv_monthly_financial_summary AS
WITH monthly_detail AS (
  SELECT
    EXTRACT(YEAR  FROM occurred_on)::INTEGER AS fiscal_year,
    EXTRACT(MONTH FROM occurred_on)::INTEGER AS fiscal_month,
    transaction_type,
    category,
    SUM(amount)                              AS total_amount
  FROM transactions
  GROUP BY 1, 2, 3, 4
),
monthly_totals AS (
  SELECT
    fiscal_year,
    fiscal_month,
    to_char(make_date(fiscal_year, fiscal_month, 1), 'FMMonth YYYY') AS period_label,
    SUM(total_amount) FILTER (WHERE transaction_type = 'revenue')    AS total_revenue,
    SUM(total_amount) FILTER (WHERE transaction_type = 'expense')    AS total_expenses
  FROM monthly_detail
  GROUP BY fiscal_year, fiscal_month
)
SELECT
  t.fiscal_year,
  t.fiscal_month,
  t.period_label,
  t.total_revenue,
  t.total_expenses,
  (t.total_revenue - t.total_expenses)                               AS net_income,
  CASE
    WHEN t.total_revenue > 0
    THEN ROUND(
           ((t.total_revenue - t.total_expenses) / t.total_revenue * 100)::numeric,
           2
         )
    ELSE 0
  END                                                                AS net_margin_pct,
  -- revenue breakdown
  SUM(d.total_amount) FILTER (
    WHERE d.transaction_type = 'revenue' AND d.category = 'consultations')    AS rev_consultations,
  SUM(d.total_amount) FILTER (
    WHERE d.transaction_type = 'revenue' AND d.category = 'insurance_claims') AS rev_insurance_claims,
  SUM(d.total_amount) FILTER (
    WHERE d.transaction_type = 'revenue' AND d.category = 'lab_services')     AS rev_lab_services,
  SUM(d.total_amount) FILTER (
    WHERE d.transaction_type = 'revenue' AND d.category = 'pharmacy_sales')   AS rev_pharmacy_sales,
  -- expense breakdown
  SUM(d.total_amount) FILTER (
    WHERE d.transaction_type = 'expense' AND d.category = 'salaries')         AS exp_salaries,
  SUM(d.total_amount) FILTER (
    WHERE d.transaction_type = 'expense' AND d.category = 'equipment')        AS exp_equipment,
  SUM(d.total_amount) FILTER (
    WHERE d.transaction_type = 'expense' AND d.category = 'rent')             AS exp_rent,
  SUM(d.total_amount) FILTER (
    WHERE d.transaction_type = 'expense' AND d.category = 'utilities')        AS exp_utilities,
  SUM(d.total_amount) FILTER (
    WHERE d.transaction_type = 'expense' AND d.category = 'compliance_costs') AS exp_compliance_costs
FROM monthly_totals t
JOIN monthly_detail  d USING (fiscal_year, fiscal_month)
GROUP BY
  t.fiscal_year, t.fiscal_month, t.period_label,
  t.total_revenue, t.total_expenses
ORDER BY t.fiscal_year, t.fiscal_month;

CREATE UNIQUE INDEX uidx_mv_monthly_summary_period
  ON mv_monthly_financial_summary (fiscal_year, fiscal_month);

-- Populate the materialized view immediately.
-- NOTE: CONCURRENTLY cannot be used here because the view is empty on first
--       run.  Use REFRESH MATERIALIZED VIEW CONCURRENTLY for subsequent
--       incremental refreshes once the view already contains data.
REFRESH MATERIALIZED VIEW mv_monthly_financial_summary;
