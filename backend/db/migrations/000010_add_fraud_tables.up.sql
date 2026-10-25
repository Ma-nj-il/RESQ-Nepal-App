-- Fraud alerts table
CREATE TABLE fraud_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    alert_type VARCHAR(50) NOT NULL CHECK (alert_type IN (
        'payment_fraud', 'account_fraud', 'location_fraud',
        'ride_fraud', 'rating_manipulation', 'promo_abuse'
    )),
    alert_level VARCHAR(20) NOT NULL CHECK (alert_level IN ('low', 'medium', 'high', 'critical')),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'investigating', 'confirmed', 'false_positive', 'resolved'
    )),
    description TEXT NOT NULL,
    details JSONB DEFAULT '{}',
    risk_score DECIMAL(5,2) NOT NULL CHECK (risk_score >= 0 AND risk_score <= 100),
    detected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    investigated_at TIMESTAMP WITH TIME ZONE,
    investigated_by UUID REFERENCES users(id),
    resolved_at TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    action_taken TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- User risk profiles table
CREATE TABLE user_risk_profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    risk_score DECIMAL(5,2) NOT NULL DEFAULT 0.00 CHECK (risk_score >= 0 AND risk_score <= 100),
    total_alerts INTEGER NOT NULL DEFAULT 0,
    critical_alerts INTEGER NOT NULL DEFAULT 0,
    confirmed_fraud_cases INTEGER NOT NULL DEFAULT 0,
    last_alert_at TIMESTAMP WITH TIME ZONE,
    account_suspended BOOLEAN DEFAULT false,
    last_updated TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Fraud patterns table (for pattern detection)
CREATE TABLE fraud_patterns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pattern_type VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    occurrences INTEGER NOT NULL DEFAULT 1,
    affected_users UUID[] NOT NULL DEFAULT '{}',
    first_detected TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_detected TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    details JSONB DEFAULT '{}',
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add payment_method_id column to payments table
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_method_id UUID;

-- Indexes for fraud_alerts
CREATE INDEX idx_fraud_alerts_user_id ON fraud_alerts(user_id);
CREATE INDEX idx_fraud_alerts_status ON fraud_alerts(status);
CREATE INDEX idx_fraud_alerts_alert_level ON fraud_alerts(alert_level);
CREATE INDEX idx_fraud_alerts_alert_type ON fraud_alerts(alert_type);
CREATE INDEX idx_fraud_alerts_detected_at ON fraud_alerts(detected_at);
CREATE INDEX idx_fraud_alerts_status_level ON fraud_alerts(status, alert_level);

-- Indexes for user_risk_profiles
CREATE INDEX idx_user_risk_profiles_risk_score ON user_risk_profiles(risk_score);
CREATE INDEX idx_user_risk_profiles_suspended ON user_risk_profiles(account_suspended);
CREATE INDEX idx_user_risk_profiles_last_updated ON user_risk_profiles(last_updated);

-- Indexes for fraud_patterns
CREATE INDEX idx_fraud_patterns_pattern_type ON fraud_patterns(pattern_type);
CREATE INDEX idx_fraud_patterns_severity ON fraud_patterns(severity);
CREATE INDEX idx_fraud_patterns_is_active ON fraud_patterns(is_active);
CREATE INDEX idx_fraud_patterns_last_detected ON fraud_patterns(last_detected);

-- Indexes for payments (payment_method_id)
CREATE INDEX idx_payments_payment_method_id ON payments(payment_method_id);

-- Trigger for fraud_alerts updated_at
CREATE TRIGGER update_fraud_alerts_updated_at BEFORE UPDATE ON fraud_alerts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger for fraud_patterns updated_at
CREATE TRIGGER update_fraud_patterns_updated_at BEFORE UPDATE ON fraud_patterns
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
