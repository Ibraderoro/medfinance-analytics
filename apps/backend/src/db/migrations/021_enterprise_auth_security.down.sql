DROP TABLE IF EXISTS auth_security_events;
DROP TABLE IF EXISTS user_recovery_codes;
DROP TABLE IF EXISTS auth_sessions;
DROP TABLE IF EXISTS tenant_oidc_providers;
DROP TABLE IF EXISTS organization_auth_policies;

ALTER TABLE refresh_tokens
  DROP COLUMN IF EXISTS rotated_from_token_hash,
  DROP COLUMN IF EXISTS user_agent,
  DROP COLUMN IF EXISTS ip_address,
  DROP COLUMN IF EXISTS device_id;
