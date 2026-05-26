DROP INDEX IF EXISTS idx_api_request_metrics_archive_redis_entry_id;
ALTER TABLE IF EXISTS api_request_metrics_archive DROP COLUMN IF EXISTS redis_entry_id;
DROP INDEX IF EXISTS idx_api_request_metrics_redis_entry_id;
ALTER TABLE IF EXISTS api_request_metrics DROP COLUMN IF EXISTS redis_entry_id;
