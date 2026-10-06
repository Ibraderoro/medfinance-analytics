# Plan: 024_users_role_migration.down.sql

## Top-Level Overview

Migration 024 converts legacy user roles (`cfo`, `finance_manager`, `auditor`) to the current
RBAC roles (`admin`, `analyst`, `viewer`). The migration runner (`validateMigrationPlan()` in
`apps/backend/src/db/migrate.ts`) hard-blocks deployment if any forward migration lacks a
corresponding `.down.sql`. Therefore, `024_users_role_migration.down.sql` **must** be created
before 024 can be deployed.

The down migration should be schema-safe and explicitly non-lossy: it must not silently corrupt
data, and it must not attempt to reverse a data transformation that cannot be safely reversed.
The approach follows the established project precedent set by
`023_fix_financial_cash_reserves_tenant_pk.down.sql`: use a `DO $$ ... $$` guard that raises an
exception if live rows exist, preventing silent data corruption while still satisfying the runner's
structural requirement.

**Scope:** Create one file. No framework changes. No schema additions.

---

## Key Facts from Code Research

- `validateMigrationPlan()` (`apps/backend/src/db/migrate.ts:190-195`) throws hard if `.down.sql`
  is absent — 024 cannot deploy without this file.
- `002_users_schema.sql` already defines `CHECK (role IN ('admin', 'analyst', 'viewer'))` — the
  same values that 024's forward migration lands on. There is no "legacy constraint" to restore;
  the constraint body is identical before and after 024.
- 024's forward migration only changes **data rows** (`cfo→admin`, `finance_manager→analyst`,
  `auditor→viewer`). The constraint drop/re-add in 024 is structurally a no-op against the
  schema that 002 already established.
- `auditor→viewer` is genuinely ambiguous on rollback: you cannot distinguish a formerly-auditor
  user from a legitimately-viewer user. Attempting to convert `viewer` back to `auditor` would
  corrupt real viewer users.
- `023_fix_financial_cash_reserves_tenant_pk.down.sql` is the established project precedent for
  "rollback is structurally present but data-conditionally blocked."
- Neither "make 024 irreversible in the framework" nor "add a provenance column" is warranted
  given the existing guard pattern.

---

## Sub-Tasks

### Sub-Task 1 — Create `024_users_role_migration.down.sql`

**Status:** [ ] pending

**Intent**

Satisfy the migration runner's hard requirement (`.down.sql` must exist) while protecting against
silent data corruption. The file must:

1. Raise a clear exception if any rows exist that were converted by the forward migration — i.e.,
   if `role IN ('admin', 'analyst')` exists (these values could only exist in production because
   024 ran; `viewer` is ambiguous and cannot be tested). The guard should check for the presence
   of `admin` or `analyst` role values, which are the only unambiguous signal that 024 ran on
   live data.
2. After the guard, formally drop and re-add the `users_role_check` constraint for structural
   symmetry (even though the values are identical to the current constraint). This keeps the
   schema_migrations bookkeeping coherent.
3. Include clear comments explaining why data reversion is not attempted.

**Why guard on `admin` or `analyst` — not `viewer`?**

`viewer` existed before 024 and cannot be used as a signal that converted data is present.
`admin` and `analyst` could theoretically predate 024 if seeded manually, but in practice their
presence after 024 runs means converted rows exist. The guard errs on the side of safety.
If the operator needs to rollback on a system where `admin`/`analyst` were manually seeded before
024 ever ran, the exception message should make clear they can truncate or reassign roles manually
first if they are certain no conversion occurred.

**Expected Outcomes**

- `024_users_role_migration.down.sql` exists in `apps/backend/src/db/migrations/`
- `validateMigrationPlan()` no longer throws for migration 024
- Rolling back 024 on a system with converted users raises:
  ```
  Unsafe rollback: users table contains admin or analyst role values which cannot be
  safely reverted to legacy roles without data loss. Reassign or remove those rows manually
  before rolling back.
  ```
- Rolling back 024 on an empty or viewer-only users table completes cleanly (constraint
  drop/re-add succeeds)

**Todo List**

1. Create `apps/backend/src/db/migrations/024_users_role_migration.down.sql`
2. Add the `DO $$ BEGIN ... END $$` guard block that raises an exception if any `admin` or
   `analyst` role rows exist in the `users` table
3. Add `ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`
4. Add `ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'analyst', 'viewer'))`
   — same values, for structural symmetry
5. Add comments explaining why no data reversion is attempted

**Relevant Context**

- Forward migration: `apps/backend/src/db/migrations/024_users_role_migration.sql`
- Precedent guard pattern: `apps/backend/src/db/migrations/023_fix_financial_cash_reserves_tenant_pk.down.sql`
- Migration runner validation: `apps/backend/src/db/migrate.ts:190-195` (`validateMigrationPlan`)
- Rollback executor: `apps/backend/src/db/migrate.ts:237-270` (`rollbackOneMigration`)
- Original constraint definition: `apps/backend/src/db/migrations/002_users_schema.sql:10-11`

---

## Design Decisions Recorded

| Question | Decision | Rationale |
|---|---|---|
| Make 024 irreversible in the framework? | No | Over-engineered; the guard pattern already provides a clean operator experience with no framework changes |
| Add a provenance column to support full rollback? | No | Changes schema purely for rollback support; constitutes over-engineering for a role rename migration |
| Restore legacy constraint on rollback? | N/A — no legacy constraint exists | 002 already defines the same `admin/analyst/viewer` set; 024 never introduced a different constraint |
| Guard condition | Presence of `admin` or `analyst` rows | `viewer` is ambiguous; `admin`/`analyst` are the only unambiguous signals that converted rows are present |
| Pattern to follow | 023 `DO $$ RAISE EXCEPTION $$` guard | Established project precedent; no new abstractions |
