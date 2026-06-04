# Observability dashboard queries

Use these PromQL examples against the `/api/v1/internal/observability/metrics` scrape target. These queries are safe for multiple backend replicas because they aggregate counters and histograms across instances.

- Request rate
  - `sum(rate(http_server_requests_total[5m]))`
- 5xx error ratio
  - `sum(rate(http_server_requests_total{outcome="error"}[5m])) / clamp_min(sum(rate(http_server_requests_total[5m])), 0.001)`
- Route-level p95 latency
  - `histogram_quantile(0.95, sum by (le, route, method) (rate(http_server_request_duration_seconds_bucket[5m])))`
- PostgreSQL p95 query latency
  - `histogram_quantile(0.95, sum by (le, operation) (rate(db_client_query_duration_seconds_bucket[5m])))`
- Redis p95 operation latency
  - `histogram_quantile(0.95, sum by (le, operation) (rate(redis_client_operation_duration_seconds_bucket[5m])))`

Alert example:

- `sum(rate(http_server_requests_total{outcome="error"}[5m])) / clamp_min(sum(rate(http_server_requests_total[5m])), 0.001) > 0.02`

## Trace and log correlation notes

- The backend accepts and emits W3C `traceparent` and `x-trace-id` headers.
- JSON logs emitted during request handling include `trace_id`, `span_id`, and `trace_sampled`.
- Configure production sampling with `OTEL_TRACES_SAMPLER=parentbased_traceidratio` and `OTEL_TRACES_SAMPLER_ARG=0.10` as a safe starting point.
