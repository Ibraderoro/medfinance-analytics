-- Link local users to immutable OIDC provider identities.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS idp_issuer TEXT,
  ADD COLUMN IF NOT EXISTS idp_subject TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_idp_identity
  ON users (organization_id, idp_issuer, idp_subject)
  WHERE idp_issuer IS NOT NULL AND idp_subject IS NOT NULL;
