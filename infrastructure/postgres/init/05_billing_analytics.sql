-- MedFinance Analytics billing + internal analytics schema

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  stripe_subscription_id VARCHAR(255) UNIQUE NOT NULL,
  plan VARCHAR(50) NOT NULL DEFAULT 'starter',
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end TIMESTAMPTZ NOT NULL,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_organization_id ON subscriptions (organization_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions (status);

CREATE TABLE IF NOT EXISTS api_request_metrics (
  id BIGSERIAL PRIMARY KEY,
  endpoint TEXT NOT NULL,
  method VARCHAR(8) NOT NULL,
  status_code INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  user_id UUID,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_request_metrics_created_at
  ON api_request_metrics (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_request_metrics_endpoint
  ON api_request_metrics (endpoint);
CREATE INDEX IF NOT EXISTS idx_api_request_metrics_user_id
  ON api_request_metrics (user_id)
  WHERE user_id IS NOT NULL;
