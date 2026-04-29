DROP INDEX IF EXISTS idx_refresh_tokens_expires_at;
DROP INDEX IF EXISTS idx_refresh_tokens_token_hash;
DROP INDEX IF EXISTS idx_refresh_tokens_user;
DROP TABLE IF EXISTS refresh_tokens;

DROP INDEX IF EXISTS idx_users_organisation;
DROP INDEX IF EXISTS idx_users_email;
DROP TABLE IF EXISTS users;

DROP TYPE IF EXISTS user_role;
