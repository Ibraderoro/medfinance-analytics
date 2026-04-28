-- MedFinance Analytics users schema

CREATE TABLE IF NOT EXISTS users (
  id               UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  email            VARCHAR(255) NOT NULL UNIQUE,
  password_hash    TEXT         NOT NULL,
  first_name       VARCHAR(100) NOT NULL,
  last_name        VARCHAR(100) NOT NULL,
  role             VARCHAR(32)  NOT NULL DEFAULT 'viewer'
                     CHECK (role IN ('cfo', 'finance_manager', 'auditor', 'viewer')),
  organization_id  UUID         NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  is_active        BOOLEAN      NOT NULL DEFAULT true,
  last_login_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email        ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_organization ON users(organization_id);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT        NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user       ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);
