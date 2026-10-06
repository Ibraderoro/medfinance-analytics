-- Rollback for 024_users_role_migration.sql
--
-- This migration converted legacy role values in the users table:
--   cfo             -> admin
--   finance_manager -> analyst
--   auditor         -> viewer
--
-- Data reversion is NOT attempted here for two reasons:
--
--   1. The auditor->viewer mapping is ambiguous: after the forward migration runs,
--      there is no way to distinguish a user who was legitimately 'viewer' before
--      the migration from one who was 'auditor'. Converting all 'viewer' rows back
--      to 'auditor' would corrupt legitimate viewer accounts.
--
--   2. The constraint introduced by this migration is identical to the one already
--      defined in 002_users_schema.sql (role IN ('admin', 'analyst', 'viewer')).
--      There is no legacy constraint to restore.
--
-- If admin or analyst rows are present, the forward migration has run against live
-- data and cannot be safely reversed. The rollback is blocked to prevent silent
-- data loss. If you are certain no role conversion occurred (e.g. this is a clean
-- environment where those values were seeded directly), manually reassign or remove
-- the affected rows and re-run the rollback.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE role IN ('admin', 'analyst')) THEN
    RAISE EXCEPTION
      'Unsafe rollback: users table contains admin or analyst role values which cannot '
      'be safely reverted to legacy roles without data loss. Reassign or remove those '
      'rows manually before rolling back migration 024.';
  END IF;
END $$;

-- Re-apply the constraint for structural symmetry. The values are identical to
-- those established by 002_users_schema.sql; this block exists so that rollback
-- leaves the schema_migrations table consistent with the forward migration having
-- been undone.
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'analyst', 'viewer'));
