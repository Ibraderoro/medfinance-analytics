ALTER TABLE api_request_metrics
  ADD COLUMN IF NOT EXISTS redis_entry_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_api_request_metrics_redis_entry_id
  ON api_request_metrics (redis_entry_id)
  WHERE redis_entry_id IS NOT NULL;

ALTER TABLE api_request_metrics_archive
  ADD COLUMN IF NOT EXISTS redis_entry_id TEXT;

CREATE INDEX IF NOT EXISTS idx_api_request_metrics_archive_redis_entry_id
  ON api_request_metrics_archive (redis_entry_id)
  WHERE redis_entry_id IS NOT NULL;
