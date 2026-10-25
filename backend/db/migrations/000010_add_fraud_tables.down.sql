-- Drop triggers
DROP TRIGGER IF EXISTS update_fraud_alerts_updated_at ON fraud_alerts;
DROP TRIGGER IF EXISTS update_fraud_patterns_updated_at ON fraud_patterns;

-- Drop indexes
DROP INDEX IF EXISTS idx_fraud_alerts_user_id;
DROP INDEX IF EXISTS idx_fraud_alerts_status;
DROP INDEX IF EXISTS idx_fraud_alerts_alert_level;
DROP INDEX IF EXISTS idx_fraud_alerts_alert_type;
DROP INDEX IF EXISTS idx_fraud_alerts_detected_at;
DROP INDEX IF EXISTS idx_fraud_alerts_status_level;

DROP INDEX IF EXISTS idx_user_risk_profiles_risk_score;
DROP INDEX IF EXISTS idx_user_risk_profiles_suspended;
DROP INDEX IF EXISTS idx_user_risk_profiles_last_updated;

DROP INDEX IF EXISTS idx_fraud_patterns_pattern_type;
DROP INDEX IF EXISTS idx_fraud_patterns_severity;
DROP INDEX IF EXISTS idx_fraud_patterns_is_active;
DROP INDEX IF EXISTS idx_fraud_patterns_last_detected;

DROP INDEX IF EXISTS idx_payments_payment_method_id;

-- Remove payment_method_id column from payments table
ALTER TABLE payments DROP COLUMN IF EXISTS payment_method_id;

-- Drop tables
DROP TABLE IF EXISTS fraud_patterns;
DROP TABLE IF EXISTS user_risk_profiles;
DROP TABLE IF EXISTS fraud_alerts;
