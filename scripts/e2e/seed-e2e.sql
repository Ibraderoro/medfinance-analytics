BEGIN;

-- Normalize deterministic E2E identities on top of the production-like seed.
UPDATE users
SET role = 'admin', is_active = true
WHERE email = 'demo@medfinance.test';

INSERT INTO organizations (id, name)
VALUES (md5('org_medfinance_isolated')::uuid, 'MedFinance Isolated Org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, email, password_hash, first_name, last_name, role, organization_id, is_active)
VALUES
  (md5('user_e2e_viewer')::uuid, 'viewer@medfinance.test', '$2a$12$mH/JllR1HHEYeoqF5yKt4evTqGGdXja3X9Ac8T5G9WxPHqU46zKBK', 'E2E', 'Viewer', 'viewer', md5('org_medfinance_demo')::uuid, true),
  (md5('user_e2e_other_tenant')::uuid, 'other-tenant@medfinance.test', '$2a$12$mH/JllR1HHEYeoqF5yKt4evTqGGdXja3X9Ac8T5G9WxPHqU46zKBK', 'Other', 'Tenant', 'admin', md5('org_medfinance_isolated')::uuid, true)
ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  role = EXCLUDED.role,
  organization_id = EXCLUDED.organization_id,
  is_active = true;

INSERT INTO departments (id, organization_id, department_code, name, cost_center, status)
VALUES (md5('dept_other_tenant_revenue')::uuid, md5('org_medfinance_isolated')::uuid, 'ISO-001', 'Isolated Revenue', 'CC-ISO-001', 'active')
ON CONFLICT (organization_id, department_code) DO NOTHING;

INSERT INTO transactions (id, organization_id, department_id, transaction_type, category, invoice_number, description, amount, tax_amount, currency, occurred_on)
VALUES
  (md5('txn_other_tenant_revenue')::uuid, md5('org_medfinance_isolated')::uuid, md5('dept_other_tenant_revenue')::uuid, 'revenue', 'tenant_isolation_marker', 'INV-ISO-001', 'Revenue visible only to isolated tenant', 777777.00, 0.00, 'USD', CURRENT_DATE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO customers (organization_id, stripe_customer_id, email)
VALUES (md5('org_medfinance_demo')::uuid, 'cus_e2e_demo_org', 'billing@medfinance.test')
ON CONFLICT (organization_id) DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id, email = EXCLUDED.email;

INSERT INTO subscriptions (id, organization_id, stripe_subscription_id, plan, status, current_period_start, current_period_end)
VALUES (md5('sub_e2e_demo_free')::uuid, md5('org_medfinance_demo')::uuid, 'sub_e2e_demo_free', 'free', 'inactive', NOW(), NOW() + INTERVAL '30 days')
ON CONFLICT (stripe_subscription_id) DO UPDATE SET plan = EXCLUDED.plan, status = EXCLUDED.status, current_period_end = EXCLUDED.current_period_end;

COMMIT;
