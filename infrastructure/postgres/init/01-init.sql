-- MedFinance Analytics core financial schema

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO organizations (id, name)
VALUES (md5('default_organization')::uuid, 'Default Organization')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  department_code VARCHAR(24) NOT NULL,
  name VARCHAR(120) NOT NULL,
  cost_center VARCHAR(32) NOT NULL,
  parent_department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, department_code),
  UNIQUE (organization_id, cost_center)
);

CREATE TABLE IF NOT EXISTS forecasts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  fiscal_year INTEGER NOT NULL CHECK (fiscal_year BETWEEN 2000 AND 2100),
  fiscal_month INTEGER NOT NULL CHECK (fiscal_month BETWEEN 1 AND 12),
  metric_type VARCHAR(16) NOT NULL CHECK (metric_type IN ('revenue', 'expense')),
  projected_amount NUMERIC(16, 2) NOT NULL CHECK (projected_amount >= 0),
  scenario VARCHAR(24) NOT NULL DEFAULT 'baseline' CHECK (scenario IN ('baseline', 'best_case', 'worst_case')),
  confidence_score NUMERIC(5, 2) CHECK (confidence_score BETWEEN 0 AND 100),
  assumptions JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, department_id, fiscal_year, fiscal_month, metric_type, scenario)
);

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  forecast_id UUID REFERENCES forecasts(id) ON DELETE SET NULL,
  transaction_type VARCHAR(16) NOT NULL CHECK (transaction_type IN ('revenue', 'expense')),
  category VARCHAR(64) NOT NULL,
  vendor_name VARCHAR(160),
  invoice_number VARCHAR(64),
  description TEXT,
  amount NUMERIC(16, 2) NOT NULL CHECK (amount >= 0),
  tax_amount NUMERIC(16, 2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  occurred_on DATE NOT NULL,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_departments_organization ON departments(organization_id);
CREATE INDEX IF NOT EXISTS idx_forecasts_organization ON forecasts(organization_id);
CREATE INDEX IF NOT EXISTS idx_transactions_organization ON transactions(organization_id);
CREATE INDEX IF NOT EXISTS idx_transactions_occurred_on ON transactions(occurred_on DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_type_date ON transactions(transaction_type, occurred_on DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_department_date ON transactions(department_id, occurred_on DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_forecast_id ON transactions(forecast_id);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category);
CREATE INDEX IF NOT EXISTS idx_forecasts_department_period ON forecasts(department_id, fiscal_year, fiscal_month);
CREATE INDEX IF NOT EXISTS idx_forecasts_metric_period ON forecasts(metric_type, fiscal_year, fiscal_month);
CREATE INDEX IF NOT EXISTS idx_departments_parent ON departments(parent_department_id);
CREATE INDEX IF NOT EXISTS idx_departments_status ON departments(status);
