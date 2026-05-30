# Observability Stack Setup

## Components

- **Structured logs**: Winston JSON logs with request context and correlation IDs.
- **Tracing**: OpenTelemetry Node SDK with OTLP exporter.
- **Metrics**:
  - API metrics at `GET /api/v1/internal/observability/metrics` (internal-only)
  - DB query latency metrics
  - Redis operation latency metrics
- **Prometheus**: Scrapes backend, Redis exporter, and cAdvisor.
- **Grafana**: Pre-provisioned dashboard JSON (`medfinance-overview.json`).
- **Container monitoring**: cAdvisor for Docker resource telemetry.

## Start locally with observability

```bash
docker compose up -d --build
```

## Endpoints

- Backend API: `http://localhost:3001/api/v1`
- Public liveness check: `GET /api/v1/health/live`
- Internal readiness check: `GET /api/v1/health/ready`
- Internal Prometheus scrape: `GET /api/v1/internal/observability/metrics`
- Internal metrics summary: `GET /api/v1/internal/observability/metrics/summary`
- Admin metrics summary: `GET /api/v1/admin/observability/metrics-summary`
- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3002`
- Redis exporter: `http://localhost:9121/metrics`
- cAdvisor: `http://localhost:8081`

## Grafana bootstrap

1. Sign in with `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD` (defaults `admin/admin`).
2. Add Prometheus data source URL: `http://prometheus:9090`.
3. Open dashboard: **MedFinance API Overview**.

## OpenTelemetry environment

The backend is configured with:

- `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318`

Optional additions:

- `OTEL_SERVICE_NAME=medfinance-backend`
- `OTEL_RESOURCE_ATTRIBUTES=deployment.environment=local`

## Operational notes

- Public traffic should only use `/api/v1/health/live`; readiness and metrics are restricted to private networks.
- Backend operational endpoint controls are enforced by:
  - `OPS_ALLOWLIST_CIDRS` IP allowlisting
  - optional token auth with `OPS_ENDPOINT_AUTH_ENABLED=true` and `OPS_ENDPOINT_AUTH_TOKEN`
  - audit logging for both allowed and denied operational endpoint access events
- Nginx restricts `/api/v1/health/ready` and `/api/v1/internal/observability/*` to RFC1918/loopback sources.
- Prometheus scraping is preserved through the private `observability` Docker network targeting backend directly.
- Alert on `http_error_rate`, `http_request_duration_p95_ms`, and dependency health failures.
- Correlate incidents using `x-request-id` present in logs and responses.
