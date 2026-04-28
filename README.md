# MedFinance Analytics

Production-focused monorepo for healthcare financial analytics (API + frontend + infra).

## Local development

```bash
cp .env.example .env
npm install
npm run build --workspace=apps/backend
npm run migrate --workspace=apps/backend
npm run seed --workspace=apps/backend
npm run dev --workspace=apps/backend
```

Frontend:

```bash
npm run dev --workspace=apps/frontend
```

## Production stack with Docker Compose

```bash
cp .env.example .env
docker compose build
docker compose up -d
```

Services:
- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:3001/api/v1`
- Health checks: `GET /api/v1/health/live`, `GET /api/v1/health/ready`

## Backend hardening highlights

- Consistent API response envelope:
  - success: `{ "success": true, "data": ... }`
  - error: `{ "success": false, "error": { "message": "...", "code": "..." } }`
- Global error middleware with request context and stack logging.
- Request ID tracing with `X-Request-Id` propagation.
- JWT auth hardened (`issuer`, `audience`, `algorithm` checks).
- Input validation via `express-validator` + sanitization middleware.
- Postgres/Redis startup retry logic for container orchestration.
- Migration-based schema hardening and performance indexes.
- Route-level integration tests for:
  - `/financials/summary`
  - `/forecasting/forecast`
  - `/compliance/status`

## Useful commands

```bash
npm run test --workspace=apps/backend
npm run lint --workspace=apps/backend
npm run migrate --workspace=apps/backend
```
