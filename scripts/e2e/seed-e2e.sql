BEGIN;

-- ============================================================
-- Organizations
-- ============================================================

-- Ensure the isolated tenant exists.
INSERT INTO organizations (
  id,
  name
)
VALUES (
  md5('org_medfinance_isolated')::uuid,
  'MedFinance Isolated Org'
)
ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- Deterministic E2E users
-- ============================================================

INSERT INTO users (
  id,
  email,
  password_hash,
  first_name,
  last_name,
  role,
  organization_id,
  is_active
)
VALUES
(
  md5('user_e2e_demo')::uuid,
  'demo@medfinance.test',
  '$2a$12$ZFrA56Nk2mbcN0WIeE57XOWaipTb79WP4nPrNOdpS801IblalXRGy',
  'Demo',
  'CFO',
  'viewer',
  md5('org_medfinance_demo')::uuid,
  true
),
(
  md5('user_e2e_viewer')::uuid,
  'viewer@medfinance.test',
  '$2a$12$ZFrA56Nk2mbcN0WIeE57XOWaipTb79WP4nPrNOdpS801IblalXRGy',
  'E2E',
  'Viewer',
  'viewer',
  md5('org_medfinance_demo')::uuid,
  true
),
(
  md5('user_e2e_analyst')::uuid,
  'analyst@medfinance.test',
  '$2a$12$ZFrA56Nk2mbcN0WIeE57XOWaipTb79WP4nPrNOdpS801IblalXRGy',
  'E2E',
  'Analyst',
  'analyst',
  md5('org_medfinance_demo')::uuid,
  true
),
(
  md5('user_e2e_other_tenant')::uuid,
  'other-tenant@medfinance.test',
  '$2a$12$ZFrA56Nk2mbcN0WIeE57XOWaipTb79WP4nPrNOdpS801IblalXRGy',
  'Other',
  'Tenant',
  'viewer',
  md5('org_medfinance_isolated')::uuid,
  true
),
(
  md5('user_perf_bench')::uuid,
  'perf@medfinance.test',
  '$2a$12$U/WEGdlGrrgqdYFpTZ68hui7NVsRia9ZZgMW0.L36oQ/QiOo4N.y6',
  'Perf',
  'Bench',
  'viewer',
  md5('org_medfinance_demo')::uuid,
  true
)
ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  role = EXCLUDED.role,
  organization_id = EXCLUDED.organization_id,
  is_active = true;


-- ============================================================
-- Isolated tenant department
-- ============================================================

INSERT INTO departments (
  id,
  organization_id,
  department_code,
  name,
  cost_center,
  status
)
VALUES (
  md5('dept_other_tenant_revenue')::uuid,
  md5('org_medfinance_isolated')::uuid,
  'ISO-001',
  'Isolated Revenue',
  'CC-ISO-001',
  'active'
)
ON CONFLICT (department_code) DO UPDATE SET
  organization_id = EXCLUDED.organization_id,
  name = EXCLUDED.name,
  cost_center = EXCLUDED.cost_center,
  status = EXCLUDED.status;


-- ============================================================
-- Tenant-isolation revenue fixture
-- ============================================================

-- This transaction is intentionally unique to the isolated
-- organization. The E2E test verifies that:
--
--   Demo tenant    -> does NOT see 777777.00
--   Isolated tenant -> DOES see 777777.00
--
-- The revenue API returns month + total, not description,
-- so the test should assert against the 777777.00 amount.

INSERT INTO transactions (
  id,
  organization_id,
  department_id,
  transaction_type,
  category,
  invoice_number,
  description,
  amount,
  tax_amount,
  currency,
  occurred_on
)
VALUES (
  md5('txn_other_tenant_revenue')::uuid,
  md5('org_medfinance_isolated')::uuid,
  md5('dept_other_tenant_revenue')::uuid,
  'revenue',
  'tenant_isolation_marker',
  'INV-ISO-001',
  'Revenue visible only to isolated tenant',
  777777.00,
  0.00,
  'USD',
  CURRENT_DATE
)
ON CONFLICT (id) DO UPDATE SET
  organization_id = EXCLUDED.organization_id,
  department_id = EXCLUDED.department_id,
  transaction_type = EXCLUDED.transaction_type,
  category = EXCLUDED.category,
  invoice_number = EXCLUDED.invoice_number,
  description = EXCLUDED.description,
  amount = EXCLUDED.amount,
  tax_amount = EXCLUDED.tax_amount,
  currency = EXCLUDED.currency,
  occurred_on = EXCLUDED.occurred_on;


-- ============================================================
-- Billing customers
-- ============================================================

INSERT INTO customers (
  id,
  organization_id,
  stripe_customer_id,
  email
)
VALUES
(
  md5('cust_e2e_demo_org')::uuid,
  md5('org_medfinance_demo')::uuid,
  'cus_e2e_demo_org',
  'billing@medfinance.test'
),
(
  md5('cust_e2e_isolated_org')::uuid,
  md5('org_medfinance_isolated')::uuid,
  'cus_e2e_isolated_org',
  'billing-isolated@medfinance.test'
)
ON CONFLICT (organization_id)
DO UPDATE SET
  stripe_customer_id = EXCLUDED.stripe_customer_id,
  email = EXCLUDED.email;


-- ============================================================
-- Billing subscriptions
-- ============================================================

INSERT INTO subscriptions (
  id,
  organization_id,
  customer_id,
  stripe_subscription_id,
  plan,
  status,
  current_period_start,
  current_period_end
)
VALUES
(
  md5('sub_e2e_demo_pro')::uuid,
  md5('org_medfinance_demo')::uuid,
  md5('cust_e2e_demo_org')::uuid,
  'sub_e2e_demo_pro',
  'pro',
  'active',
  NOW(),
  NOW() + INTERVAL '30 days'
),
(
  md5('sub_e2e_isolated_pro')::uuid,
  md5('org_medfinance_isolated')::uuid,
  md5('cust_e2e_isolated_org')::uuid,
  'sub_e2e_isolated_pro',
  'pro',
  'active',
  NOW(),
  NOW() + INTERVAL '30 days'
)
ON CONFLICT (stripe_subscription_id)
DO UPDATE SET
  customer_id = EXCLUDED.customer_id,
  plan = EXCLUDED.plan,
  status = EXCLUDED.status,
  current_period_start = EXCLUDED.current_period_start,
  current_period_end = EXCLUDED.current_period_end;


COMMIT;