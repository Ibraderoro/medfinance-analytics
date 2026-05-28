-- Enterprise authentication hardening: tenant MFA policy, OIDC IdP metadata, sessions, and recovery codes.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS organization_auth_policies (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  mfa_enforced BOOLEAN NOT NULL DEFAULT TRUE,
  step_up_required_for_exports BOOLEAN NOT NULL DEFAULT TRUE,
  step_up_required_for_billing BOOLEAN NOT NULL DEFAULT TRUE,
  suspicious_login_mfa BOOLEAN NOT NULL DEFAULT TRUE,
  session_absolute_timeout_minutes INTEGER NOT NULL DEFAULT 720 CHECK (session_absolute_timeout_minutes BETWEEN 15 AND 43200),
  session_idle_timeout_minutes INTEGER NOT NULL DEFAULT 60 CHECK (session_idle_timeout_minutes BETWEEN 5 AND 1440),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS tenant_oidc_providers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  issuer TEXT NOT NULL,
  authorization_url TEXT NOT NULL,
  token_url TEXT NOT NULL,
  userinfo_url TEXT NOT NULL,
  jwks_uri TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_secret_ref TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT 'openid email profile',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, issuer)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  UNIQUE (user_id, device_id)
);

ALTER TABLE refresh_tokens
  ADD COLUMN IF NOT EXISTS device_id TEXT,
  ADD COLUMN IF NOT EXISTS ip_address TEXT,
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS rotated_from_token_hash TEXT;

CREATE TABLE IF NOT EXISTS user_recovery_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at TIMESTAMPTZ,
  UNIQUE (user_id, code_hash)
);

CREATE TABLE IF NOT EXISTS auth_security_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_org_last_seen ON auth_sessions (organization_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_recovery_codes_unused ON user_recovery_codes (user_id, created_at) WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_auth_security_events_org_created ON auth_security_events (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tenant_oidc_enabled ON tenant_oidc_providers (organization_id, enabled) WHERE enabled = TRUE;

ALTER TABLE IF EXISTS organization_auth_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS tenant_oidc_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS user_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS auth_security_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy ON organization_auth_policies;
CREATE POLICY tenant_isolation_policy ON organization_auth_policies
USING (organization_id = current_setting('app.current_tenant_id', true)::uuid)
WITH CHECK (organization_id = current_setting('app.current_tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_policy ON tenant_oidc_providers;
CREATE POLICY tenant_isolation_policy ON tenant_oidc_providers
USING (organization_id = current_setting('app.current_tenant_id', true)::uuid)
WITH CHECK (organization_id = current_setting('app.current_tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_policy ON auth_sessions;
CREATE POLICY tenant_isolation_policy ON auth_sessions
USING (organization_id = current_setting('app.current_tenant_id', true)::uuid)
WITH CHECK (organization_id = current_setting('app.current_tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_policy ON user_recovery_codes;
CREATE POLICY tenant_isolation_policy ON user_recovery_codes
USING (organization_id = current_setting('app.current_tenant_id', true)::uuid)
WITH CHECK (organization_id = current_setting('app.current_tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_policy ON auth_security_events;
CREATE POLICY tenant_isolation_policy ON auth_security_events
USING (organization_id = current_setting('app.current_tenant_id', true)::uuid)
WITH CHECK (organization_id = current_setting('app.current_tenant_id', true)::uuid);
