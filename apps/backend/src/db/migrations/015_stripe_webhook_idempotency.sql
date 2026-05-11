CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'processed')),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processing_expires_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  CONSTRAINT stripe_webhook_events_status_timestamps_check CHECK (
    (status = 'processing' AND processing_expires_at IS NOT NULL AND processed_at IS NULL)
    OR
    (status = 'processed' AND processing_expires_at IS NULL AND processed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_status_received
  ON stripe_webhook_events(status, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_processing_expires
  ON stripe_webhook_events(processing_expires_at)
  WHERE status = 'processing';
