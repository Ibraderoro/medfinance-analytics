CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  tenant_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('CREATE', 'READ', 'UPDATE', 'DELETE')),
  target_resource TEXT NOT NULL,
  request_id TEXT,
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION prevent_audit_logs_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is immutable; % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_audit_logs_update ON audit_logs;
CREATE TRIGGER trg_prevent_audit_logs_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_logs_mutation();

DROP TRIGGER IF EXISTS trg_prevent_audit_logs_delete ON audit_logs;
CREATE TRIGGER trg_prevent_audit_logs_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_logs_mutation();

ALTER TABLE IF EXISTS transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy ON transactions;
CREATE POLICY tenant_isolation_policy ON transactions
USING (tenant_id::text = current_setting('app.current_tenant_id', true));
