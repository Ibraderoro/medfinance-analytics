CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS organization_domains (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  domain TEXT NOT NULL CHECK (domain = lower(domain) AND domain !~* '^@' AND domain LIKE '%.%'),
  verification_token_hash TEXT NOT NULL,
  verified_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_organization_domains_org_verified
  ON organization_domains (organization_id, verified_at)
  WHERE verified_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS organization_invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email CITEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('analyst', 'viewer')),
  invited_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE,
  token_jti UUID NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  accepted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT organization_invitations_single_terminal_state CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_organization_invitations_org_created
  ON organization_invitations (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_organization_invitations_pending_email
  ON organization_invitations (organization_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_organization_invitations_expires_at
  ON organization_invitations (expires_at)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

ALTER TABLE IF EXISTS organization_invitations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON organization_invitations;
CREATE POLICY tenant_isolation_policy ON organization_invitations
USING (organization_id = current_setting('app.current_tenant_id', true)::uuid)
WITH CHECK (organization_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE IF EXISTS organization_domains ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON organization_domains;
CREATE POLICY tenant_isolation_policy ON organization_domains
USING (organization_id = current_setting('app.current_tenant_id', true)::uuid)
WITH CHECK (organization_id = current_setting('app.current_tenant_id', true)::uuid);
