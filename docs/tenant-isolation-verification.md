# Tenant isolation verification

MedFinance treats every PostgreSQL table with an `organization_id` or `tenant_id` column as tenant-scoped. The automated verifier discovers those tables from `pg_catalog` instead of relying on a hand-maintained allowlist.

## What CI enforces

The verifier fails closed when any tenant-scoped table is missing one of these controls:

1. `ENABLE ROW LEVEL SECURITY` is set on the table.
2. `FORCE ROW LEVEL SECURITY` is set so table owners cannot bypass policies accidentally.
3. At least one `FOR ALL` tenant policy exists with both `USING` and `WITH CHECK` expressions comparing the tenant column to `current_setting('app.current_tenant_id', true)::uuid`.

The backend CI job runs migration preflight, applies all migrations to an ephemeral PostgreSQL database, and then executes the tenant isolation verifier as part of the migration command. This prevents a migration from introducing a tenant table without RLS hardening.

## Running locally

```bash
DATABASE_URL=postgresql://medfinance:medfinance@127.0.0.1:5432/medfinance_test \
PG_SSL=false \
npm run migrate --workspace=apps/backend
```

To verify an already-migrated database without applying new migrations:

```bash
DATABASE_URL=postgresql://medfinance:medfinance@127.0.0.1:5432/medfinance_test \
PG_SSL=false \
npm run db:tenant-isolation:verify --workspace=apps/backend
```

## Report artifact

Each verification run writes `tenant-isolation-report.json` by default. Set `TENANT_ISOLATION_REPORT_PATH` to write the report elsewhere. CI uploads this report as the `tenant-isolation-report` artifact even when verification fails so reviewers can see the exact table and policy findings.

## Migration author checklist

When adding a table with `organization_id` or `tenant_id`:

- Add the tenant column as `NOT NULL` unless there is a documented bootstrap exception.
- Add or rely on the hardening migration pattern that enables RLS, forces RLS, and creates a tenant policy before the migration is considered complete.
- Run `npm run migrate --workspace=apps/backend` against a disposable database and inspect `tenant-isolation-report.json` before opening a PR.
