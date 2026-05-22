DROP TRIGGER IF EXISTS trg_prevent_audit_logs_truncate ON audit_logs;
DROP TRIGGER IF EXISTS trg_prevent_audit_logs_update ON audit_logs;
DROP TRIGGER IF EXISTS trg_prevent_audit_logs_delete ON audit_logs;

DROP FUNCTION IF EXISTS prevent_audit_logs_mutation();

-- Intentionally do not broaden table privileges during rollback.
