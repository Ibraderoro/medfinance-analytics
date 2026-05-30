# CI/CD Failure Troubleshooting Runbook

## Purpose

Diagnose failures in linting, testing, typechecking, builds, migrations, images, deployment, and post-deploy verification.

## Failure Categories

| Category | Examples |
|---|---|
| Dependency install | npm lock mismatch, package registry failure |
| Type/lint | TypeScript errors, ESLint violations |
| Unit/integration tests | Jest failures, missing env, flaky DB/Redis |
| E2E tests | Playwright browser install, app not reachable |
| Build/image | Dockerfile error, missing build args |
| Migration | SQL syntax, lock timeout, non-idempotent migration |
| Deploy | Platform auth, quota, health-check failure |

## Local Reproduction Commands

```bash
npm ci
npm run typecheck --workspace=apps/backend
npm run test --workspace=apps/backend
npm run typecheck --workspace=apps/frontend
npm run test --workspace=apps/frontend
npm run build --workspace=apps/backend
npm run build --workspace=apps/frontend
```

## Docker Build Debugging

```bash
docker compose build backend
docker compose build frontend
docker compose up -d postgres redis
docker compose logs --tail=200 backend
```

## Migration Failure Debugging

```bash
DATABASE_URL=<database-url> npm run migrate --workspace=apps/backend
DATABASE_URL=<database-url> npm run migrate:rollback --workspace=apps/backend
```

Review migration idempotency:

```bash
sed -n '1,220p' apps/backend/src/db/migrations/<migration>.sql
sed -n '1,220p' apps/backend/src/db/migrations/<migration>.down.sql
```

## Health Check Failure After Deploy

```bash
curl -sS https://<deploy-preview-api>/api/v1/health/ready | jq .
<platform-cli> logs <service> --since 20m
```

## Common Fixes

| Failure | Fix |
|---|---|
| Lockfile mismatch | Regenerate lockfile intentionally and review dependency changes. |
| Test requires env | Add safe test env defaults or mock external service. |
| Migration fails on existing object | Use `IF EXISTS` / `IF NOT EXISTS` where safe. |
| Build args missing | Add documented defaults or CI secret configuration. |
| Health check timeout | Confirm service port, dependency readiness, and startup time. |

## Escalation

- Escalate to owning team for repeated test failures.
- Escalate to SRE for deployment platform, image registry, or runner failures.
- Escalate to database owner for migration failures against shared environments.
