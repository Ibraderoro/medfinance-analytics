-- Backend hardening migration: consistency indexes + schema safety

CREATE TABLE IF NOT EXISTS compliance_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  regulation_code VARCHAR(64) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'under_review'
    CHECK (status IN ('compliant', 'non_compliant', 'under_review')),
  last_reviewed_at TIMESTAMPTZ,
  next_review_due_at TIMESTAMPTZ NOT NULL,
  assigned_to VARCHAR(255),
  organization_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='compliance_items' AND column_name='organisation_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='compliance_items' AND column_name='organization_id'
  ) THEN
    ALTER TABLE compliance_items RENAME COLUMN organisation_id TO organization_id;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='regulatory_alerts' AND column_name='organisation_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='regulatory_alerts' AND column_name='organization_id'
  ) THEN
    ALTER TABLE regulatory_alerts RENAME COLUMN organisation_id TO organization_id;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_transactions_org_year
  ON transactions (organization_id, occurred_on DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_org_type_year
  ON transactions (organization_id, transaction_type, occurred_on DESC);

CREATE INDEX IF NOT EXISTS idx_compliance_items_org_due
  ON compliance_items (organization_id, next_review_due_at ASC);

CREATE INDEX IF NOT EXISTS idx_regulatory_alerts_org_severity_due
  ON regulatory_alerts (organization_id, severity, due_date ASC);

CREATE INDEX IF NOT EXISTS idx_audit_log_org_performed_at
  ON audit_log (organization_id, performed_at DESC);
