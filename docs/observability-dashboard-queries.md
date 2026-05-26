# Observability dashboard queries

Use these example PromQL queries against `/api/v1/health/metrics` scrape target:

- Request count
  - `sum(http_requests_total)`
- Error rate
  - `sum(http_errors_total) / sum(http_requests_total)`
- p95 latency (ms)
  - `max(http_request_duration_p95_ms)`

Alert example:

- `sum(http_errors_total) / sum(http_requests_total) > 0.05`


## APM correlation notes

- The backend observability middleware enriches the active OpenTelemetry span with:
  - `http.request_id` (from `req.requestId`, which is populated from `X-Request-Id` when provided, otherwise middleware-generated)
  - `http.method`, `http.route`, `http.status_code`, `http.response_time_ms`
  - `tenant.organization_id` and `enduser.id` when authenticated context exists
- For 5xx responses, it emits an `http.request.failed` span event containing the request id and latency for rapid triage.
- Configure exporter endpoints with `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` (or `OTEL_EXPORTER_OTLP_ENDPOINT`) and optional `OTEL_EXPORTER_OTLP_HEADERS`.
