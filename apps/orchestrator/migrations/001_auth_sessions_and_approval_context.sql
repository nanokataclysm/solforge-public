-- Owner-run additive migration for durable front-door sessions.
-- The application never executes this file or performs startup DDL.
-- Apply to a reviewed database/branch before starting the new application code.
BEGIN;

CREATE TABLE IF NOT EXISTS solforge_auth_sessions (
  token_hash text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS solforge_auth_sessions_expires_idx
  ON solforge_auth_sessions (expires_at);

ALTER TABLE solforge_approval_sessions
  ADD COLUMN IF NOT EXISTS auth_session_hash text,
  ADD COLUMN IF NOT EXISTS operation text,
  ADD COLUMN IF NOT EXISTS artifact_context_id text,
  ADD COLUMN IF NOT EXISTS parent_version_digest text;

COMMIT;
