-- Migration 001: initial schema
-- Applied by: apps/backend/src/db/migrate.ts
-- Description: Create all core tables for MedFinance Analytics

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Organisations
CREATE TABLE IF NOT EXISTS organisations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Users
CREATE TABLE IF NOT EXISTS users (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id   UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  email             TEXT NOT NULL UNIQUE,
  password_hash     TEXT NOT NULL,
  role              TEXT NOT NULL CHECK (role IN ('cfo', 'finance_manager', 'auditor', 'viewer')),
  first_name        TEXT,
  last_name         TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Financial Transactions
CREATE TABLE IF NOT EXISTS financial_transactions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id   UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  type              TEXT NOT NULL CHECK (type IN ('revenue', 'expense')),
  amount            NUMERIC(18, 2) NOT NULL,
  category          TEXT NOT NULL,
  description       TEXT,
  transaction_date  DATE NOT NULL,
  reference_number  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_org ON financial_transactions(organisation_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON financial_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON financial_transactions(type);

-- Budgets
CREATE TABLE IF NOT EXISTS budgets (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id   UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  category          TEXT NOT NULL,
  budgeted_amount   NUMERIC(18, 2) NOT NULL,
  fiscal_year       INTEGER NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, category, fiscal_year)
);

-- Compliance Items
CREATE TABLE IF NOT EXISTS compliance_items (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id     UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  regulation_code     TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('compliant', 'non_compliant', 'under_review')),
  last_reviewed_at    TIMESTAMPTZ,
  next_review_due_at  TIMESTAMPTZ NOT NULL,
  assigned_to         UUID REFERENCES users(id),
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Regulatory Alerts
CREATE TABLE IF NOT EXISTS regulatory_alerts (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organisation_id   UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  description       TEXT,
  severity          TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  regulation_code   TEXT,
  due_date          DATE NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('open', 'acknowledged', 'resolved')) DEFAULT 'open',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit Log
CREATE TABLE IF NOT EXISTS audit_log (
  id              BIGSERIAL PRIMARY KEY,
  organisation_id UUID REFERENCES organisations(id) ON DELETE SET NULL,
  action          TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  entity_id       TEXT,
  performed_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  performed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata        JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_log(organisation_id);
CREATE INDEX IF NOT EXISTS idx_audit_performed_at ON audit_log(performed_at DESC);
