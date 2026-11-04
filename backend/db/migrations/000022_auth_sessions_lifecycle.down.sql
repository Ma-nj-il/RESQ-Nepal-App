DROP TABLE IF EXISTS auth_audit_events;
DROP TABLE IF EXISTS account_recovery_codes;
DROP TABLE IF EXISTS auth_sessions;

DROP INDEX IF EXISTS idx_users_account_status;
DROP INDEX IF EXISTS idx_users_phone_e164_unique;
DROP INDEX IF EXISTS idx_users_email_ci_unique;

ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_auth_version_check,
    DROP CONSTRAINT IF EXISTS users_account_status_check,
    DROP COLUMN IF EXISTS terms_accepted_at,
    DROP COLUMN IF EXISTS terms_version,
    DROP COLUMN IF EXISTS auth_version,
    DROP COLUMN IF EXISTS account_status;
