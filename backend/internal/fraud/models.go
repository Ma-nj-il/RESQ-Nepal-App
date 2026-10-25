package fraud

import (
	"time"

	"github.com/google/uuid"
)

type FraudAlertLevel string

const (
	AlertLevelLow      FraudAlertLevel = "low"
	AlertLevelMedium   FraudAlertLevel = "medium"
	AlertLevelHigh     FraudAlertLevel = "high"
	AlertLevelCritical FraudAlertLevel = "critical"
)

type FraudAlertType string

const (
	AlertTypePaymentFraud       FraudAlertType = "payment_fraud"
	AlertTypeAccountFraud       FraudAlertType = "account_fraud"
	AlertTypeLocationFraud      FraudAlertType = "location_fraud"
	AlertTypeRideFraud          FraudAlertType = "ride_fraud"
	AlertTypeRatingManipulation FraudAlertType = "rating_manipulation"
	AlertTypePromoAbuse         FraudAlertType = "promo_abuse"
)

type FraudAlertStatus string

const (
	AlertStatusPending       FraudAlertStatus = "pending"
	AlertStatusInvestigating FraudAlertStatus = "investigating"
	AlertStatusConfirmed     FraudAlertStatus = "confirmed"
	AlertStatusFalsePositive FraudAlertStatus = "false_positive"
	AlertStatusResolved      FraudAlertStatus = "resolved"
)

type FraudAlert struct {
	ID             uuid.UUID              `json:"id" gorm:"primaryKey;type:uuid"`
	UserID         uuid.UUID              `json:"user_id" gorm:"type:uuid;index"`
	AlertType      FraudAlertType         `json:"alert_type" gorm:"type:varchar(50)"`
	AlertLevel     FraudAlertLevel        `json:"alert_level" gorm:"type:varchar(20)"`
	Status         FraudAlertStatus       `json:"status" gorm:"type:varchar(20);default:'pending'"`
	Description    string                 `json:"description" gorm:"type:text"`
	Details        map[string]interface{} `json:"details" gorm:"serializer:json"`
	RiskScore      float64                `json:"risk_score"`
	DetectedAt     time.Time              `json:"detected_at" gorm:"autoCreateTime"`
	InvestigatedAt *time.Time             `json:"investigated_at,omitempty"`
	InvestigatedBy *uuid.UUID             `json:"investigated_by,omitempty" gorm:"type:uuid"`
	ResolvedAt     *time.Time             `json:"resolved_at,omitempty"`
	Notes          string                 `json:"notes,omitempty" gorm:"type:text"`
	ActionTaken    string                 `json:"action_taken,omitempty" gorm:"type:text"`
	UpdatedAt      time.Time              `json:"updated_at" gorm:"autoUpdateTime"`
}

func (FraudAlert) TableName() string {
	return "fraud_alerts"
}

type UserRiskProfile struct {
	UserID              uuid.UUID  `json:"user_id" gorm:"primaryKey;type:uuid"`
	RiskScore           float64    `json:"risk_score"`
	TotalAlerts         int        `json:"total_alerts"`
	CriticalAlerts      int        `json:"critical_alerts"`
	ConfirmedFraudCases int        `json:"confirmed_fraud_cases"`
	LastAlertAt         *time.Time `json:"last_alert_at,omitempty"`
	AccountSuspended    bool       `json:"account_suspended" gorm:"default:false"`
	LastUpdated         time.Time  `json:"last_updated" gorm:"autoUpdateTime"`
}

func (UserRiskProfile) TableName() string {
	return "user_risk_profiles"
}

type FraudPattern struct {
	PatternType   string                 `json:"pattern_type" gorm:"primaryKey;type:varchar(50)"`
	Description   string                 `json:"description" gorm:"type:text"`
	Occurrences   int                    `json:"occurrences"`
	AffectedUsers []uuid.UUID            `json:"affected_users" gorm:"serializer:json"`
	FirstDetected time.Time              `json:"first_detected" gorm:"autoCreateTime"`
	LastDetected  time.Time              `json:"last_detected" gorm:"autoUpdateTime"`
	Details       map[string]interface{} `json:"details" gorm:"serializer:json"`
	Severity      FraudAlertLevel        `json:"severity" gorm:"type:varchar(20)"`
	IsActive      bool                   `json:"is_active" gorm:"default:true"`
}

func (FraudPattern) TableName() string {
	return "fraud_patterns"
}

type PaymentFraudIndicators struct {
	UserID                 uuid.UUID `json:"user_id"`
	FailedPaymentAttempts  int       `json:"failed_payment_attempts"`
	ChargebackCount        int       `json:"chargeback_count"`
	MultiplePaymentMethods int       `json:"multiple_payment_methods"`
	SuspiciousTransactions int       `json:"suspicious_transactions"`
	RapidPaymentChanges    bool      `json:"rapid_payment_changes"`
	RiskScore              float64   `json:"risk_score"`
}

type RideFraudIndicators struct {
	UserID                 uuid.UUID `json:"user_id"`
	ExcessiveCancellations int       `json:"excessive_cancellations"`
	UnusualRidePatterns    bool      `json:"unusual_ride_patterns"`
	FakeGPSDetected        bool      `json:"fake_gps_detected"`
	CollisionWithDriver    bool      `json:"collision_with_driver"`
	PromoAbuse             bool      `json:"promo_abuse"`
	RiskScore              float64   `json:"risk_score"`
}

type AccountFraudIndicators struct {
	UserID                     uuid.UUID `json:"user_id"`
	MultipleAccountsSameDevice bool      `json:"multiple_accounts_same_device"`
	RapidAccountCreation       bool      `json:"rapid_account_creation"`
	SuspiciousEmailPattern     bool      `json:"suspicious_email_pattern"`
	FakePhoneNumber            bool      `json:"fake_phone_number"`
	VPNUsage                   bool      `json:"vpn_usage"`
	RiskScore                  float64   `json:"risk_score"`
}

type FraudStatistics struct {
	Period                 string  `json:"period"`
	TotalAlerts            int     `json:"total_alerts"`
	CriticalAlerts         int     `json:"critical_alerts"`
	HighAlerts             int     `json:"high_alerts"`
	MediumAlerts           int     `json:"medium_alerts"`
	LowAlerts              int     `json:"low_alerts"`
	ConfirmedFraudCases    int     `json:"confirmed_fraud_cases"`
	FalsePositives         int     `json:"false_positives"`
	PendingInvestigation   int     `json:"pending_investigation"`
	EstimatedLossPrevented float64 `json:"estimated_loss_prevented"`
	AverageResponseTime    int     `json:"average_response_time_minutes"`
}
