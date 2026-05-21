DROP POLICY IF EXISTS tenant_isolation_policy ON transactions;
ALTER TABLE IF EXISTS transactions DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON audit_logs;
ALTER TABLE IF EXISTS audit_logs DISABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS trg_prevent_audit_logs_update ON audit_logs;
DROP TRIGGER IF EXISTS trg_prevent_audit_logs_delete ON audit_logs;
DROP FUNCTION IF EXISTS prevent_audit_logs_mutation();
DROP TABLE IF EXISTS audit_logs;
