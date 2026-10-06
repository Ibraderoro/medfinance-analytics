-- Migrate legacy user roles to the current RBAC roles.
-- Legacy roles:
--   cfo             -> admin
--   finance_manager -> analyst
--   auditor         -> viewer
--   viewer          -> viewer

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_role_check;

UPDATE users
SET role = CASE role
  WHEN 'cfo' THEN 'admin'
  WHEN 'finance_manager' THEN 'analyst'
  WHEN 'auditor' THEN 'viewer'
  ELSE role
END
WHERE role IN ('cfo', 'finance_manager', 'auditor');

ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'analyst', 'viewer'));
