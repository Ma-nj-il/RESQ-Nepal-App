package fraud

import (
	"context"
	"fmt"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/database"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Repository struct {
	db *database.DBPool
}

var _ FraudRepository = (*Repository)(nil)

func NewRepository(db *database.DBPool) *Repository {
	return &Repository{db: db}
}

func (r *Repository) CreateFraudAlert(ctx context.Context, alert *FraudAlert) error {
	return r.db.Primary.WithContext(ctx).Create(alert).Error
}

func (r *Repository) GetFraudAlertByID(ctx context.Context, alertID uuid.UUID) (*FraudAlert, error) {
	var alert FraudAlert
	err := r.db.Primary.WithContext(ctx).First(&alert, "id = ?", alertID).Error
	if err != nil {
		return nil, err
	}
	return &alert, nil
}

func (r *Repository) GetAlertsByUser(ctx context.Context, userID uuid.UUID, limit, offset int) ([]*FraudAlert, error) {
	var alerts []*FraudAlert
	err := r.db.Primary.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("detected_at DESC").
		Limit(limit).
		Offset(offset).
		Find(&alerts).Error

	return alerts, err
}

func (r *Repository) GetPendingAlerts(ctx context.Context, limit, offset int) ([]*FraudAlert, error) {
	var alerts []*FraudAlert
	err := r.db.Primary.WithContext(ctx).
		Where("status IN ?", []string{string(AlertStatusPending), string(AlertStatusInvestigating)}).
		Order("alert_level DESC, detected_at DESC").
		Limit(limit).
		Offset(offset).
		Find(&alerts).Error

	return alerts, err
}

func (r *Repository) GetAlertsByUserWithTotal(ctx context.Context, userID uuid.UUID, limit, offset int) ([]*FraudAlert, int64, error) {
	var total int64
	err := r.db.Primary.WithContext(ctx).Model(&FraudAlert{}).Where("user_id = ?", userID).Count(&total).Error
	if err != nil {
		return nil, 0, err
	}

	alerts, err := r.GetAlertsByUser(ctx, userID, limit, offset)
	return alerts, total, err
}

func (r *Repository) GetPendingAlertsWithTotal(ctx context.Context, limit, offset int) ([]*FraudAlert, int64, error) {
	var total int64
	err := r.db.Primary.WithContext(ctx).Model(&FraudAlert{}).
		Where("status IN ?", []string{string(AlertStatusPending), string(AlertStatusInvestigating)}).
		Count(&total).Error
	if err != nil {
		return nil, 0, err
	}

	alerts, err := r.GetPendingAlerts(ctx, limit, offset)
	return alerts, total, err
}

func (r *Repository) UpdateAlertStatus(ctx context.Context, alertID uuid.UUID, status FraudAlertStatus, investigatedBy *uuid.UUID, notes, actionTaken string) error {
	updates := map[string]interface{}{
		"status":     status,
		"updated_at": time.Now(),
	}

	if investigatedBy != nil {
		updates["investigated_at"] = time.Now()
		updates["investigated_by"] = investigatedBy
	}

	if status == AlertStatusConfirmed || status == AlertStatusFalsePositive || status == AlertStatusResolved {
		updates["resolved_at"] = time.Now()
	}

	if notes != "" {
		updates["notes"] = notes
	}
	if actionTaken != "" {
		updates["action_taken"] = actionTaken
	}

	return r.db.Primary.WithContext(ctx).Model(&FraudAlert{}).Where("id = ?", alertID).Updates(updates).Error
}

func (r *Repository) GetUserRiskProfile(ctx context.Context, userID uuid.UUID) (*UserRiskProfile, error) {
	var profile UserRiskProfile
	err := r.db.Primary.WithContext(ctx).First(&profile, "user_id = ?", userID).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return &UserRiskProfile{
				UserID:              userID,
				RiskScore:           0,
				TotalAlerts:         0,
				CriticalAlerts:      0,
				ConfirmedFraudCases: 0,
				AccountSuspended:    false,
				LastUpdated:         time.Now(),
			}, nil
		}
		return nil, err
	}
	return &profile, nil
}

func (r *Repository) UpdateUserRiskProfile(ctx context.Context, profile *UserRiskProfile) error {
	return r.db.Primary.WithContext(ctx).Save(profile).Error
}

func (r *Repository) GetPaymentFraudIndicators(ctx context.Context, userID uuid.UUID) (*PaymentFraudIndicators, error) {
	indicators := &PaymentFraudIndicators{UserID: userID}

	err := r.db.Primary.WithContext(ctx).Table("payments").
		Select(`
			COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_payment_attempts,
			COUNT(CASE WHEN status = 'refunded' THEN 1 END) as chargeback_count,
			COUNT(DISTINCT payment_method_id) as multiple_payment_methods,
			COUNT(CASE WHEN amount > 1000 THEN 1 END) as suspicious_transactions
		`).
		Where("user_id = ? AND created_at >= NOW() - INTERVAL '30 days'", userID).
		Scan(indicators).Error

	if err != nil {
		return nil, err
	}

	var changes int64
	r.db.Primary.WithContext(ctx).Table("payments").
		Where("user_id = ? AND created_at >= NOW() - INTERVAL '7 days'", userID).
		Select("COUNT(DISTINCT payment_method_id)").
		Scan(&changes)

	indicators.RapidPaymentChanges = changes > 3
	indicators.RiskScore = calculatePaymentRiskScore(indicators)

	return indicators, nil
}

func (r *Repository) GetRideFraudIndicators(ctx context.Context, userID uuid.UUID) (*RideFraudIndicators, error) {
	indicators := &RideFraudIndicators{UserID: userID}
	var totalRides int64

	err := r.db.Primary.WithContext(ctx).Table("rides").
		Select(`
			COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as excessive_cancellations,
			COUNT(*) as total_rides
		`).
		Where("(rider_id = ? OR driver_id = ?) AND requested_at >= NOW() - INTERVAL '30 days'", userID, userID).
		Scan(&struct {
			ExcessiveCancellations int   `gorm:"column:excessive_cancellations"`
			TotalRides             int64 `gorm:"column:total_rides"`
		}{}).Scan(indicators).Error

	var result struct {
		Cancellations int   `gorm:"column:excessive_cancellations"`
		Total         int64 `gorm:"column:total_rides"`
	}
	err = r.db.Primary.WithContext(ctx).Table("rides").
		Select(`
			COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as excessive_cancellations,
			COUNT(*) as total_rides
		`).
		Where("(rider_id = ? OR driver_id = ?) AND requested_at >= NOW() - INTERVAL '30 days'", userID, userID).
		Scan(&result).Error

	if err != nil {
		return nil, err
	}
	indicators.ExcessiveCancellations = result.Cancellations
	totalRides = result.Total

	var promoCount int64
	r.db.Primary.WithContext(ctx).Table("rides").
		Where("rider_id = ? AND promo_code_id IS NOT NULL AND requested_at >= NOW() - INTERVAL '30 days'", userID).
		Count(&promoCount)

	indicators.PromoAbuse = promoCount > 5

	if totalRides > 0 {
		cancellationRate := float64(indicators.ExcessiveCancellations) / float64(totalRides)
		indicators.UnusualRidePatterns = cancellationRate > 0.5 || totalRides > 100
	}

	indicators.RiskScore = calculateRideRiskScore(indicators)

	return indicators, nil
}

func calculatePaymentRiskScore(indicators *PaymentFraudIndicators) float64 {
	score := 0.0

	score += float64(indicators.FailedPaymentAttempts) * 3
	if score > 30 {
		score = 30
	}

	score += float64(indicators.ChargebackCount) * 15
	if score > 60 {
		score = 60
	}

	if indicators.MultiplePaymentMethods > 5 {
		score += 20
	} else if indicators.MultiplePaymentMethods > 3 {
		score += 10
	}

	score += float64(indicators.SuspiciousTransactions) * 5
	if score > 100 {
		score = 100
	}

	if indicators.RapidPaymentChanges {
		score += 10
	}

	if score > 100 {
		score = 100
	}

	return score
}

func calculateRideRiskScore(indicators *RideFraudIndicators) float64 {
	score := 0.0

	score += float64(indicators.ExcessiveCancellations) * 2
	if score > 40 {
		score = 40
	}

	if indicators.UnusualRidePatterns {
		score += 20
	}

	if indicators.FakeGPSDetected {
		score += 30
	}

	if indicators.CollisionWithDriver {
		score += 30
	}

	if indicators.PromoAbuse {
		score += 20
	}

	if score > 100 {
		score = 100
	}

	return score
}

func (r *Repository) GetAccountFraudIndicators(ctx context.Context, userID uuid.UUID) (*AccountFraudIndicators, error) {
	indicators := &AccountFraudIndicators{UserID: userID}

	var user struct {
		Email       string `gorm:"column:email"`
		PhoneNumber string `gorm:"column:phone_number"`
	}
	err := r.db.Primary.WithContext(ctx).Table("users").Select("email, phone_number").Where("id = ?", userID).Scan(&user).Error
	if err != nil {
		return nil, err
	}

	tempEmailPatterns := []string{"tempmail", "throwaway", "guerrillamail", "10minutemail", "mailinator"}
	for _, pattern := range tempEmailPatterns {
		if len(user.Email) > 0 && contains(user.Email, pattern) {
			indicators.SuspiciousEmailPattern = true
			break
		}
	}

	if len(user.PhoneNumber) > 0 && isRepeatingPattern(user.PhoneNumber) {
		indicators.FakePhoneNumber = true
	}

	indicators.RiskScore = calculateAccountRiskScore(indicators)
	return indicators, nil
}

func (r *Repository) GetFraudStatistics(ctx context.Context, startDate, endDate time.Time) (*FraudStatistics, error) {
	stats := &FraudStatistics{
		Period: fmt.Sprintf("%s to %s", startDate.Format("2006-01-02"), endDate.Format("2006-01-02")),
	}

	err := r.db.Primary.WithContext(ctx).Model(&FraudAlert{}).
		Select(`
			COUNT(*) as total_alerts,
			COUNT(CASE WHEN alert_level = 'critical' THEN 1 END) as critical_alerts,
			COUNT(CASE WHEN alert_level = 'high' THEN 1 END) as high_alerts,
			COUNT(CASE WHEN alert_level = 'medium' THEN 1 END) as medium_alerts,
			COUNT(CASE WHEN alert_level = 'low' THEN 1 END) as low_alerts,
			COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed_fraud_cases,
			COUNT(CASE WHEN status = 'false_positive' THEN 1 END) as false_positives,
			COUNT(CASE WHEN status IN ('pending', 'investigating') THEN 1 END) as pending_investigation,
			COALESCE(AVG(EXTRACT(EPOCH FROM (COALESCE(resolved_at, NOW()) - detected_at)) / 60), 0) as average_response_time
		`).
		Where("detected_at >= ? AND detected_at <= ?", startDate, endDate).
		Scan(stats).Error

	if err != nil {
		return nil, err
	}

	stats.EstimatedLossPrevented = float64(stats.ConfirmedFraudCases) * 50.0

	return stats, nil
}

func (r *Repository) GetFraudPatterns(ctx context.Context, limit int) ([]*FraudPattern, error) {
	var patterns []*FraudPattern
	err := r.db.Primary.WithContext(ctx).
		Where("is_active = true").
		Order("severity DESC, last_detected DESC").
		Limit(limit).
		Find(&patterns).Error

	return patterns, err
}

func (r *Repository) CreateFraudPattern(ctx context.Context, pattern *FraudPattern) error {
	return r.db.Primary.WithContext(ctx).Create(pattern).Error
}

func (r *Repository) UpdateFraudPattern(ctx context.Context, pattern *FraudPattern) error {
	return r.db.Primary.WithContext(ctx).Save(pattern).Error
}

func contains(s, substr string) bool {
	return len(s) > 0 && len(substr) > 0 && (s == substr || len(s) >= len(substr) &&
		(s[:len(substr)] == substr || s[len(s)-len(substr):] == substr ||
			len(s) > len(substr) && findSubstring(s, substr)))
}

func findSubstring(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

func isRepeatingPattern(s string) bool {
	if len(s) < 3 {
		return false
	}

	first := s[0]
	allSame := true
	for i := 1; i < len(s); i++ {
		if s[i] != first {
			allSame = false
			break
		}
	}

	return allSame
}

func calculateAccountRiskScore(indicators *AccountFraudIndicators) float64 {
	score := 0.0

	if indicators.MultipleAccountsSameDevice {
		score += 40
	}

	if indicators.RapidAccountCreation {
		score += 30
	}

	if indicators.SuspiciousEmailPattern {
		score += 20
	}

	if indicators.FakePhoneNumber {
		score += 30
	}

	if indicators.VPNUsage {
		score += 10
	}

	if score > 100 {
		score = 100
	}

	return score
}
