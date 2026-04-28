CREATE TABLE IF NOT EXISTS api_request_metrics (
  id              BIGSERIAL PRIMARY KEY,
  endpoint        TEXT        NOT NULL,
  method          VARCHAR(10) NOT NULL,
  status_code     INTEGER     NOT NULL,
  latency_ms      DOUBLE PRECISION NOT NULL,
  user_id         UUID,
  organization_id UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_request_metrics_created_at
  ON api_request_metrics (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_request_metrics_endpoint
  ON api_request_metrics (endpoint);

CREATE INDEX IF NOT EXISTS idx_api_request_metrics_user_id
  ON api_request_metrics (user_id)
  WHERE user_id IS NOT NULL;
