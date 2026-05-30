CREATE INDEX IF NOT EXISTS idx_audit_log_org_performed_at_desc
  ON audit_log (organization_id, performed_at DESC);

CREATE INDEX IF NOT EXISTS idx_regulatory_alerts_org_severity_due_date
  ON regulatory_alerts (
    organization_id,
    (
      CASE severity
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        ELSE 4
      END
    ),
    due_date ASC
  );
