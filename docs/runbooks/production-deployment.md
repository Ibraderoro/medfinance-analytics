# Production Deployment Runbook

## Proposed Production Architecture

MedFinance now uses an incremental, small-team-friendly deployment architecture instead of SSHing into a VM and running mutable Docker Compose updates.

```text
GitHub Actions
  ├─ validate/test/build
  ├─ build backend/frontend containers
  ├─ push version + sha tags
  ├─ record immutable digest manifest
  └─ dispatch self-hosted deploy runner
        ├─ pull backend@sha256 and frontend@sha256
        ├─ run migration preflight + migrations from backend digest
        ├─ start inactive blue/green color on a private Docker network
        ├─ health-gate candidate containers
        ├─ switch edge proxy to candidate color
        ├─ verify public readiness
        └─ rollback edge to previous color on failure
```

### Runtime Layout

- **Public edge only:** Nginx `edge` is the only service with a host port. Backend and frontend containers are reachable only on Docker networks.
- **Private backend:** `backend_blue` and `backend_green` expose port `3001` only to the private network; they do not publish host ports.
- **Managed data stores:** production expects managed Postgres and Redis connection strings in the host secret env file (`DATABASE_URL`, `REDIS_URL`). Production Compose no longer starts local Postgres/Redis.
- **Immutable artifacts:** deployments consume `ghcr.io/.../backend@sha256:<digest>` and `ghcr.io/.../frontend@sha256:<digest>`, not `latest`.
- **Pinned release state:** each environment stores runtime state and release metadata under `/opt/medfinance/<environment>/` by default.

## Updated CI/CD Workflow

1. `cd-production.yml` validates the release candidate, builds backend/frontend images, and records a `release-manifest.json` artifact.
2. The build job pushes only versioned and SHA tags for human lookup, then deploys by digest.
3. The deploy job runs on a self-hosted runner labeled `medfinance-production`; no SSH key is used.
4. The deploy runner logs into GHCR, validates the manifest, and executes `infrastructure/deployment/deploy-bluegreen.sh`.
5. `rollback-production.yml` provides a manual emergency rollback action that flips edge traffic back to the previous color and verifies readiness.

Required GitHub Environment variables:

| Environment | Variable | Example |
| --- | --- | --- |
| staging | `STAGING_PUBLIC_URL` | `https://staging.medfinance.example.com` |
| staging | `STAGING_DEPLOY_BASE_DIR` | `/opt/medfinance` |
| staging | `STAGING_SECRET_ENV_FILE` | `/opt/medfinance/secrets/staging.env` |
| production | `PROD_PUBLIC_URL` | `https://app.medfinance.example.com` |
| production | `PROD_DEPLOY_BASE_DIR` | `/opt/medfinance` |
| production | `PROD_SECRET_ENV_FILE` | `/opt/medfinance/secrets/app.env` |

## Infrastructure Changes

The production compose file is `infrastructure/deployment/docker-compose.bluegreen.yml`.

- `edge`: public Nginx reverse proxy. Its active upstream is controlled by `ACTIVE_COLOR`.
- `backend_blue` / `backend_green`: private API services, each pinned to an image digest.
- `frontend_blue` / `frontend_green`: private frontend services, each pinned to an image digest.
- `migration`: one-shot backend image used for migration preflight and execution.

Host prerequisites:

```bash
sudo mkdir -p /opt/medfinance/secrets /opt/medfinance/production /opt/medfinance/staging
sudo install -m 0600 app.env /opt/medfinance/secrets/app.env
sudo install -m 0600 staging.env /opt/medfinance/secrets/staging.env
```

The secret env files must contain managed-service URLs and application secrets, for example:

```bash
DATABASE_URL=postgresql://user:pass@managed-postgres.example.com:5432/medfinance?sslmode=require
REDIS_URL=rediss://:password@managed-redis.example.com:6379
JWT_SECRET=...
REFRESH_TOKEN_SECRET=...
AUDIT_EXPORT_SIGNING_SECRET=...
CORS_ALLOWED_ORIGINS=https://app.medfinance.example.com
PG_SSL=true
REDIS_TLS=true
REQUIRE_SECURE_TRANSPORT=true
```

Do not store raw `POSTGRES_PASSWORD` or `REDIS_PASSWORD` in the production deployment env file; use managed connection URLs from the provider secret store.

## Deployment Scripts

### Validate a Release Manifest

```bash
npm run release:manifest:check -- --file release-manifest.json
```

### Deploy a Pinned Release

```bash
bash infrastructure/deployment/deploy-bluegreen.sh \
  --environment production \
  --version v1.2.3 \
  --backend-image ghcr.io/org/medfinance-analytics/backend@sha256:<digest> \
  --frontend-image ghcr.io/org/medfinance-analytics/frontend@sha256:<digest> \
  --public-url https://app.medfinance.example.com
```

The script refuses mutable tags, validates managed secret injection, runs migrations from the candidate backend digest, starts the inactive color, waits for container health, switches edge traffic, and verifies `/api/v1/health/ready`.

### Verify Deployment

```bash
node scripts/deployment/verify-deployment.js \
  --url https://app.medfinance.example.com/api/v1/health/ready \
  --expected-version v1.2.3
```

## Rollback Flow

Automatic rollback is built into the deploy script: if edge health or public verification fails after switching, it re-points `edge` at the previously active color.

Manual rollback:

```bash
bash infrastructure/deployment/rollback-bluegreen.sh \
  --environment production \
  --public-url https://app.medfinance.example.com
```

Rollback is a traffic rollback, not a schema rollback. If a migration needs to be reversed, follow `docs/runbooks/database-migrations.md` after incident commander approval.

## Release Metadata Tracking

Each successful deployment writes:

- `/opt/medfinance/<environment>/runtime.env` — active color, pinned image digests, and per-color versions.
- `/opt/medfinance/<environment>/releases/<version>.json` — immutable release metadata.
- `/opt/medfinance/<environment>/current.json` — symlink to current release or rollback event metadata.
- GitHub Actions artifact `release-manifest.json` — build-time release manifest used by the deploy job.

## Risk Analysis

| Risk | Mitigation |
| --- | --- |
| Bad container image | Candidate runs on inactive color and must pass container health before traffic switch. |
| Bad route/public config | Public `/api/v1/health/ready` verification runs after switch; failure triggers edge rollback. |
| Mutable artifact drift | Deploy scripts reject images that are not pinned by digest. |
| Secret leakage | Deploy job reads host-local env files; GitHub Actions does not echo production secret values. |
| DB regression | Migrations are still preflighted, locked, and run before traffic moves to candidate code. |
| Full orchestration complexity | Keeps Docker/Nginx on a self-hosted runner instead of introducing Kubernetes. |
