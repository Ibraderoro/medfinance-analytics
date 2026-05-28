CREATE INDEX IF NOT EXISTS idx_audit_log_org_performed_at_desc
  ON audit_log (organization_id, performed_at DESC);

CREATE INDEX IF NOT EXISTS idx_regulatory_alerts_org_severity_due_date
  ON regulatory_alerts (organization_id, severity, due_date ASC);
