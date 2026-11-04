-- Provider-free account and session lifecycle. This migration intentionally
-- depends only on the users table and the uuid-ossp extension from migration 1.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS account_status VARCHAR(20) NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS terms_version VARCHAR(100),
    ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;

UPDATE users
SET account_status = CASE
    WHEN deleted_at IS NOT NULL THEN 'deleted'
    WHEN is_active = FALSE THEN 'deactivated'
    ELSE 'active'
END;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_account_status_check'
          AND conrelid = 'users'::regclass
    ) THEN
        ALTER TABLE users
            ADD CONSTRAINT users_account_status_check
            CHECK (account_status IN ('active', 'deactivated', 'deleted'));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_auth_version_check'
          AND conrelid = 'users'::regclass
    ) THEN
        ALTER TABLE users
            ADD CONSTRAINT users_auth_version_check CHECK (auth_version > 0);
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_ci_unique
    ON users (LOWER(email));
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_e164_unique
    ON users ((CASE
        WHEN phone_number ~ '^\+9779[678][0-9]{8}$' THEN phone_number
        WHEN phone_number ~ '^9779[678][0-9]{8}$' THEN '+' || phone_number
        WHEN phone_number ~ '^09[678][0-9]{8}$' THEN '+977' || SUBSTRING(phone_number FROM 2)
        WHEN phone_number ~ '^9[678][0-9]{8}$' THEN '+977' || phone_number
        ELSE phone_number
    END));
CREATE INDEX IF NOT EXISTS idx_users_account_status
    ON users (account_status);

CREATE TABLE IF NOT EXISTS auth_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash CHAR(64) NOT NULL,
    auth_version INTEGER NOT NULL DEFAULT 1 CHECK (auth_version > 0),
    remember_me BOOLEAN NOT NULL DEFAULT FALSE,
    device_name VARCHAR(255),
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    revocation_reason VARCHAR(100)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_sessions_refresh_hash
    ON auth_sessions (refresh_token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_active
    ON auth_sessions (user_id, expires_at DESC)
    WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry
    ON auth_sessions (expires_at)
    WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS account_recovery_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_account_recovery_codes_user_unused
    ON account_recovery_codes (user_id, created_at DESC)
    WHERE used_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_audit_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    session_id UUID,
    event_type VARCHAR(50) NOT NULL,
    event_status VARCHAR(20) NOT NULL CHECK (event_status IN ('success', 'failure')),
    ip_address INET,
    user_agent TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auth_audit_events_user_time
    ON auth_audit_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_audit_events_type_time
    ON auth_audit_events (event_type, created_at DESC);
