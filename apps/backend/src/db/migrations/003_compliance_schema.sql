-- MedFinance Analytics compliance schema
-- Stores compliance items, audit log entries and regulatory alerts.

CREATE TABLE IF NOT EXISTS compliance_items (
  id                  UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  regulation_code     VARCHAR(64)  NOT NULL,
  status              VARCHAR(24)  NOT NULL DEFAULT 'under_review'
                        CHECK (status IN ('compliant', 'non_compliant', 'under_review')),
  last_reviewed_at    TIMESTAMPTZ,
  next_review_due_at  TIMESTAMPTZ  NOT NULL,
  assigned_to         VARCHAR(255),
  organisation_id     UUID         NOT NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compliance_items_org    ON compliance_items(organisation_id);
CREATE INDEX IF NOT EXISTS idx_compliance_items_status ON compliance_items(status);

CREATE TABLE IF NOT EXISTS audit_log (
  id            UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  action        VARCHAR(64)  NOT NULL,
  entity_type   VARCHAR(64)  NOT NULL,
  entity_id     UUID,
  performed_by  UUID         REFERENCES users(id) ON DELETE SET NULL,
  performed_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  metadata      JSONB        NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_audit_log_performed_at   ON audit_log(performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity         ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_performed_by   ON audit_log(performed_by);

CREATE TABLE IF NOT EXISTS regulatory_alerts (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  title            VARCHAR(255) NOT NULL,
  description      TEXT,
  severity         VARCHAR(16)  NOT NULL DEFAULT 'medium'
                     CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  regulation_code  VARCHAR(64)  NOT NULL,
  due_date         DATE         NOT NULL,
  status           VARCHAR(24)  NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open', 'acknowledged', 'resolved')),
  organisation_id  UUID         NOT NULL,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_regulatory_alerts_severity ON regulatory_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_regulatory_alerts_due_date ON regulatory_alerts(due_date ASC);
CREATE INDEX IF NOT EXISTS idx_regulatory_alerts_org      ON regulatory_alerts(organisation_id);
