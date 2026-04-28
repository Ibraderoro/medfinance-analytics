# Backend Cloud Deployment Guide (Render)

This guide deploys `apps/backend` with **managed PostgreSQL + managed Redis** on Render.

## 1) Production-ready backend config

The backend now supports environment-based cloud configuration:

- `DATABASE_URL` for managed PostgreSQL
- `PG_SSL` / `PG_SSL_REJECT_UNAUTHORIZED` for provider TLS behavior
- `REDIS_URL` for managed Redis (preferred in cloud)
- `REDIS_TLS` for Redis-over-TLS providers
- fallback `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` for local dev

Health endpoints:

- Liveness: `GET /api/v1/health/live`
- Readiness: `GET /api/v1/health/ready`

Graceful shutdown behavior:

- handles `SIGTERM` + `SIGINT`
- stops accepting new requests
- closes HTTP server
- disconnects Redis and PostgreSQL pool
- exits with non-zero if shutdown timeout (10s) is exceeded

## 2) Render blueprint config file

Use the provided `render.yaml` at repo root:

- Web service from `apps/backend/Dockerfile`
- Managed PostgreSQL (`databases`)
- Managed Redis (`type: redis` service)
- Environment variable wiring for DB/Redis connection strings
- Health check path set to readiness endpoint

## 3) Deploy steps on Render

1. Push this repository to GitHub/GitLab.
2. In Render dashboard, click **New +** → **Blueprint**.
3. Select your repository and confirm `render.yaml` is detected.
4. Create the stack.
5. Wait for Postgres and Redis provisioning to complete.
6. Render builds backend Docker image using `apps/backend/Dockerfile`.
7. Render starts the web service and probes `/api/v1/health/ready`.
8. Verify service is healthy in Render logs and metrics.

## 4) Required environment variables (reference)

Render blueprint sets these for you, but keep as reference:

- `NODE_ENV=production`
- `PORT=3001`
- `LOG_LEVEL=info`
- `DATABASE_URL=<managed-postgres-connection-string>`
- `PG_SSL=true`
- `PG_SSL_REJECT_UNAUTHORIZED=false`
- `REDIS_URL=<managed-redis-connection-string>`
- `REDIS_TLS=true`
- `JWT_SECRET=<strong random secret>`
- `REFRESH_TOKEN_SECRET=<strong random secret>`
- `JWT_EXPIRES_IN=1d`
- `REFRESH_TOKEN_EXPIRES_IN=7d`
- `CORS_ALLOWED_ORIGINS=<comma-separated frontend domains>`

## 5) Post-deploy checks

Run these against your Render backend URL:

```bash
curl -i https://<your-backend>.onrender.com/api/v1/health/live
curl -i https://<your-backend>.onrender.com/api/v1/health/ready
```

Expected:

- `/live` returns `200` and `status: alive`
- `/ready` returns `200` only if PostgreSQL + Redis are reachable and app is not shutting down

## 6) Operational notes

- Keep `PG_SSL=true` in cloud environments.
- For some managed Postgres providers, `PG_SSL_REJECT_UNAUTHORIZED=false` is required.
- Prefer rotating `JWT_SECRET` and `REFRESH_TOKEN_SECRET` through Render env var updates.
- If you deploy a frontend separately, ensure it uses the same backend base URL and set `CORS_ALLOWED_ORIGINS` accordingly.
