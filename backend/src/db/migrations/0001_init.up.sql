-- 0001_init: 使用者身份 / OAuth refresh token / 後端 session 三張核心表
-- 對應 data-model.md 之 users、user_tokens、sessions

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  atlassian_account_id text NOT NULL UNIQUE,
  display_name         text NOT NULL,
  email                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- user_tokens：refresh token 以 AES-256-GCM 加密
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_tokens (
  user_id                  uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  encrypted_refresh_token  bytea NOT NULL,
  token_nonce              bytea NOT NULL,
  token_tag                bytea NOT NULL,
  scope                    text  NOT NULL,
  issued_at                timestamptz NOT NULL,
  expires_at               timestamptz,
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- sessions：對應前端 sid cookie；滑動式 7 天
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  sid           text PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  user_agent    text,
  ip_inet       inet
);

CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);
