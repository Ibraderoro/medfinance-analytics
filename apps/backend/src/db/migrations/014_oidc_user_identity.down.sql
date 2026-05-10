DROP INDEX IF EXISTS idx_users_idp_identity;

ALTER TABLE users
  DROP COLUMN IF EXISTS idp_subject,
  DROP COLUMN IF EXISTS idp_issuer;
