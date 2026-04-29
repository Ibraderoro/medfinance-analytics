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
