# Database Migration Runbook

## Architecture

MedFinance database migrations are intentionally decoupled from API startup. API instances connect to PostgreSQL and perform a read-only compatibility check before accepting traffic; they do not create, alter, or drop database objects during bootstrap.

Migration execution is owned by a dedicated release job:

1. Build and test the release artifact.
2. Start database dependencies only.
3. Run `npm run migrate:preflight --workspace=apps/backend` (or `node apps/backend/dist/db/migrate.js preflight` from the container image).
4. Run `npm run migrate --workspace=apps/backend` (or `node apps/backend/dist/db/migrate.js`).
5. Roll application instances.
6. Verify `/api/v1/health/ready`.

## Safety Controls

- **No startup migrations:** `apps/backend/src/index.ts` calls schema compatibility and required-table validation only.
- **Advisory lock:** the migration job takes a PostgreSQL advisory lock so concurrent jobs or accidental multi-instance execution fail closed instead of racing.
- **Preflight validation:** preflight checks migration naming, required rollback files, unknown applied migrations, and checksums for applied migrations that have recorded checksums.
- **Timeouts:** `MIGRATION_TIMEOUT_MS` bounds the migration job runtime and sets PostgreSQL `statement_timeout`; `MIGRATION_LOCK_TIMEOUT_MS` bounds lock acquisition and sets PostgreSQL `lock_timeout`.
- **Rollback:** each forward migration must have a `.down.sql` companion. Use `npm run migrate:rollback --workspace=apps/backend -- <steps>` to roll back the most recent migration(s).
- **Schema compatibility:** API startup verifies the current database schema version is within `APP_SCHEMA_MIN_VERSION` and `APP_SCHEMA_MAX_VERSION`. Both default to the latest migration version in the running build, which makes instances fail safely if migrations were skipped.

## Expand/Contract Guidance

Use expand/contract for every production schema change:

1. **Expand:** add nullable columns, new tables, new indexes, or backward-compatible views/functions. Deploy migrations first.
2. **Dual-read/write:** deploy application code that can operate against both the previous and expanded schema. Set `APP_SCHEMA_MIN_VERSION` to the previous compatible version and `APP_SCHEMA_MAX_VERSION` to the expanded version during the rollout when needed.
3. **Backfill:** run idempotent, restartable backfills outside request paths. Keep batches small and monitor locks, query latency, and replication lag.
4. **Contract:** after all instances are on compatible code and data is backfilled, remove old columns/tables/constraints in a later release with a separate migration.
5. **Tighten:** reset compatibility windows to the exact latest schema version after rollout is complete.

Avoid long table rewrites, blocking `ALTER TABLE` operations, and unbounded updates in a single transaction. Prefer `CREATE INDEX CONCURRENTLY` where appropriate, but remember PostgreSQL does not allow that command inside an explicit transaction; isolate such migrations and document the exception before release.

## Normal Release Procedure

```bash
npm ci
npm run build
npm run migrate:preflight --workspace=apps/backend
MIGRATION_TIMEOUT_MS=600000 MIGRATION_LOCK_TIMEOUT_MS=30000 npm run migrate --workspace=apps/backend
npm run migrate:status --workspace=apps/backend
```

Expected result: preflight passes, migrations either apply in order or report that everything is already applied, and status shows the database schema version matching the code schema version.

## Rollback Procedure

Application rollback and schema rollback are separate decisions. Prefer rolling application code back first when the migration was backward-compatible.

If a schema rollback is required:

```bash
npm run migrate:preflight --workspace=apps/backend
MIGRATION_TIMEOUT_MS=600000 npm run migrate:rollback --workspace=apps/backend -- 1
npm run migrate:status --workspace=apps/backend
```

Then deploy an application version whose compatibility window includes the resulting database schema version. If rollback would drop data, take a backup and get incident commander approval before running it.

## Failure Modes and Response

| Failure | Meaning | Action |
| --- | --- | --- |
| Advisory lock timeout | Another migration job is running or a previous session is stuck | Check active PostgreSQL sessions, confirm ownership, and retry only after the first job exits. |
| Unknown applied migration | Database has a migration not present in the artifact | Stop deployment; use the exact artifact that produced the database state or reconcile migration history. |
| Checksum mismatch | An already-applied migration file changed after application | Stop deployment; never edit applied migrations. Create a new corrective migration. |
| Startup schema mismatch | API code is incompatible with the current database schema | Do not bypass. Run migrations, adjust compatibility window for a planned expand/contract rollout, or roll back code. |
| Migration timeout | Migration exceeded the bounded runtime | Inspect PostgreSQL locks and partial effects. Transactional migrations roll back automatically; verify status before retrying. |

## Required Observability

During migration windows monitor:

- PostgreSQL active locks and blocked queries.
- API readiness and error rates.
- Query latency and connection pool saturation.
- Migration job logs, especially applied filename and rollback filename output.
