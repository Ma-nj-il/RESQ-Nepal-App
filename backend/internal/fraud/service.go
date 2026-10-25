package fraud

import (
	"context"
	"fmt"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/common"
	"github.com/google/uuid"
)

type FraudRepository interface {
	GetUserRiskProfile(ctx context.Context, userID uuid.UUID) (*UserRiskProfile, error)
	UpdateUserRiskProfile(ctx context.Context, profile *UserRiskProfile) error
	GetPaymentFraudIndicators(ctx context.Context, userID uuid.UUID) (*PaymentFraudIndicators, error)
	GetRideFraudIndicators(ctx context.Context, userID uuid.UUID) (*RideFraudIndicators, error)
	GetAccountFraudIndicators(ctx context.Context, userID uuid.UUID) (*AccountFraudIndicators, error)
	CreateFraudAlert(ctx context.Context, alert *FraudAlert) error
	GetFraudAlertByID(ctx context.Context, alertID uuid.UUID) (*FraudAlert, error)
	GetAlertsByUser(ctx context.Context, userID uuid.UUID, limit, offset int) ([]*FraudAlert, error)
	GetAlertsByUserWithTotal(ctx context.Context, userID uuid.UUID, limit, offset int) ([]*FraudAlert, int64, error)
	GetPendingAlerts(ctx context.Context, limit, offset int) ([]*FraudAlert, error)
	GetPendingAlertsWithTotal(ctx context.Context, limit, offset int) ([]*FraudAlert, int64, error)
	UpdateAlertStatus(ctx context.Context, alertID uuid.UUID, status FraudAlertStatus, investigatorID *uuid.UUID, notes, actionTaken string) error
	GetFraudStatistics(ctx context.Context, startDate, endDate time.Time) (*FraudStatistics, error)
	GetFraudPatterns(ctx context.Context, limit int) ([]*FraudPattern, error)
	CreateFraudPattern(ctx context.Context, pattern *FraudPattern) error
	UpdateFraudPattern(ctx context.Context, pattern *FraudPattern) error
}

type Service struct {
	repo FraudRepository
}

func NewService(repo FraudRepository) *Service {
	return &Service{repo: repo}
}

func (s *Service) AnalyzeUser(ctx context.Context, userID uuid.UUID) (*UserRiskProfile, error) {
	profile, err := s.repo.GetUserRiskProfile(ctx, userID)
	if err != nil {
		return nil, err
	}

	paymentIndicators, err := s.repo.GetPaymentFraudIndicators(ctx, userID)
	if err != nil {
		paymentIndicators = &PaymentFraudIndicators{UserID: userID, RiskScore: 0}
	}

	rideIndicators, err := s.repo.GetRideFraudIndicators(ctx, userID)
	if err != nil {
		rideIndicators = &RideFraudIndicators{UserID: userID, RiskScore: 0}
	}

	overallRiskScore := (paymentIndicators.RiskScore * 0.6) + (rideIndicators.RiskScore * 0.4)
	profile.RiskScore = overallRiskScore
	profile.LastUpdated = time.Now()

	if paymentIndicators.RiskScore >= 70 {
		alert := &FraudAlert{
			ID:          uuid.New(),
			UserID:      userID,
			AlertType:   AlertTypePaymentFraud,
			AlertLevel:  s.determineAlertLevel(paymentIndicators.RiskScore),
			Status:      AlertStatusPending,
			Description: "Suspicious payment activity detected",
			Details: map[string]interface{}{
				"failed_attempts":          paymentIndicators.FailedPaymentAttempts,
				"chargebacks":              paymentIndicators.ChargebackCount,
				"multiple_payment_methods": paymentIndicators.MultiplePaymentMethods,
				"rapid_changes":            paymentIndicators.RapidPaymentChanges,
			},
			RiskScore:  paymentIndicators.RiskScore,
			DetectedAt: time.Now(),
		}
		s.repo.CreateFraudAlert(ctx, alert)
		profile.TotalAlerts++
		if alert.AlertLevel == AlertLevelCritical {
			profile.CriticalAlerts++
		}
	}

	if rideIndicators.RiskScore >= 70 {
		alert := &FraudAlert{
			ID:          uuid.New(),
			UserID:      userID,
			AlertType:   AlertTypeRideFraud,
			AlertLevel:  s.determineAlertLevel(rideIndicators.RiskScore),
			Status:      AlertStatusPending,
			Description: "Suspicious ride activity detected",
			Details: map[string]interface{}{
				"excessive_cancellations": rideIndicators.ExcessiveCancellations,
				"unusual_patterns":        rideIndicators.UnusualRidePatterns,
				"promo_abuse":             rideIndicators.PromoAbuse,
			},
			RiskScore:  rideIndicators.RiskScore,
			DetectedAt: time.Now(),
		}
		s.repo.CreateFraudAlert(ctx, alert)
		profile.TotalAlerts++
		if alert.AlertLevel == AlertLevelCritical {
			profile.CriticalAlerts++
		}
	}

	if overallRiskScore >= 90 {
		profile.AccountSuspended = true
	}

	if err := s.repo.UpdateUserRiskProfile(ctx, profile); err != nil {
		return profile, err
	}

	return profile, nil
}

func (s *Service) CreateAlert(ctx context.Context, alert *FraudAlert) error {
	if alert.ID == uuid.Nil {
		alert.ID = uuid.New()
	}
	if alert.DetectedAt.IsZero() {
		alert.DetectedAt = time.Now()
	}
	if alert.Status == "" {
		alert.Status = AlertStatusPending
	}

	if err := s.repo.CreateFraudAlert(ctx, alert); err != nil {
		return common.NewInternalServerError("failed to create fraud alert")
	}

	profile, err := s.repo.GetUserRiskProfile(ctx, alert.UserID)
	if err != nil {
		profile = &UserRiskProfile{
			UserID:      alert.UserID,
			LastUpdated: time.Now(),
		}
	}

	profile.TotalAlerts++
	if alert.AlertLevel == AlertLevelCritical {
		profile.CriticalAlerts++
	}
	profile.RiskScore += alert.RiskScore * 0.1
	if profile.RiskScore > 100 {
		profile.RiskScore = 100
	}
	now := time.Now()
	profile.LastAlertAt = &now
	profile.LastUpdated = now

	s.repo.UpdateUserRiskProfile(ctx, profile)

	return nil
}

func (s *Service) GetAlert(ctx context.Context, alertID uuid.UUID) (*FraudAlert, error) {
	alert, err := s.repo.GetFraudAlertByID(ctx, alertID)
	if err != nil {
		return nil, common.NewNotFoundError("fraud alert not found", nil)
	}
	return alert, nil
}

func (s *Service) GetUserAlerts(ctx context.Context, userID uuid.UUID, limit, offset int) ([]*FraudAlert, int64, error) {
	alerts, total, err := s.repo.GetAlertsByUserWithTotal(ctx, userID, limit, offset)
	if err != nil {
		return nil, 0, common.NewInternalServerError("failed to get fraud alerts")
	}
	if alerts == nil {
		alerts = []*FraudAlert{}
	}
	return alerts, total, nil
}

func (s *Service) GetPendingAlerts(ctx context.Context, limit, offset int) ([]*FraudAlert, int64, error) {
	alerts, total, err := s.repo.GetPendingAlertsWithTotal(ctx, limit, offset)
	if err != nil {
		return nil, 0, common.NewInternalServerError("failed to get pending alerts")
	}
	if alerts == nil {
		alerts = []*FraudAlert{}
	}
	return alerts, total, nil
}

func (s *Service) InvestigateAlert(ctx context.Context, alertID, investigatorID uuid.UUID, notes string) error {
	if err := s.repo.UpdateAlertStatus(ctx, alertID, AlertStatusInvestigating, &investigatorID, notes, ""); err != nil {
		return common.NewInternalServerError("failed to update alert status")
	}
	return nil
}

func (s *Service) ResolveAlert(ctx context.Context, alertID, investigatorID uuid.UUID, confirmed bool, notes, actionTaken string) error {
	status := AlertStatusResolved
	if confirmed {
		status = AlertStatusConfirmed
	} else {
		status = AlertStatusFalsePositive
	}

	if err := s.repo.UpdateAlertStatus(ctx, alertID, status, &investigatorID, notes, actionTaken); err != nil {
		return common.NewInternalServerError("failed to resolve alert")
	}

	if confirmed {
		alert, err := s.repo.GetFraudAlertByID(ctx, alertID)
		if err == nil {
			profile, err := s.repo.GetUserRiskProfile(ctx, alert.UserID)
			if err == nil {
				profile.ConfirmedFraudCases++
				profile.RiskScore += 20
				if profile.RiskScore > 100 {
					profile.RiskScore = 100
				}
				profile.LastUpdated = time.Now()

				if profile.ConfirmedFraudCases >= 3 {
					profile.AccountSuspended = true
				}

				s.repo.UpdateUserRiskProfile(ctx, profile)
			}
		}
	}

	return nil
}

func (s *Service) GetUserRiskProfile(ctx context.Context, userID uuid.UUID) (*UserRiskProfile, error) {
	profile, err := s.repo.GetUserRiskProfile(ctx, userID)
	if err != nil {
		return nil, common.NewInternalServerError("failed to get user risk profile")
	}
	return profile, nil
}

func (s *Service) SuspendUser(ctx context.Context, userID, adminID uuid.UUID, reason string) error {
	profile, err := s.repo.GetUserRiskProfile(ctx, userID)
	if err != nil {
		profile = &UserRiskProfile{
			UserID:      userID,
			LastUpdated: time.Now(),
		}
	}

	profile.AccountSuspended = true
	profile.LastUpdated = time.Now()

	if err := s.repo.UpdateUserRiskProfile(ctx, profile); err != nil {
		return common.NewInternalServerError("failed to suspend user")
	}

	alert := &FraudAlert{
		ID:             uuid.New(),
		UserID:         userID,
		AlertType:      AlertTypeAccountFraud,
		AlertLevel:     AlertLevelCritical,
		Status:         AlertStatusConfirmed,
		Description:    "Account manually suspended for fraud",
		Details:        map[string]interface{}{"reason": reason},
		RiskScore:      100,
		DetectedAt:     time.Now(),
		InvestigatedBy: &adminID,
		ActionTaken:    "Account suspended",
		Notes:          reason,
	}
	now := time.Now()
	alert.InvestigatedAt = &now
	alert.ResolvedAt = &now

	return s.repo.CreateFraudAlert(ctx, alert)
}

func (s *Service) ReinstateUser(ctx context.Context, userID, adminID uuid.UUID, reason string) error {
	profile, err := s.repo.GetUserRiskProfile(ctx, userID)
	if err != nil {
		return common.NewNotFoundError("user risk profile not found", nil)
	}

	profile.AccountSuspended = false
	profile.RiskScore = profile.RiskScore * 0.5
	profile.LastUpdated = time.Now()

	if err := s.repo.UpdateUserRiskProfile(ctx, profile); err != nil {
		return common.NewInternalServerError("failed to reinstate user")
	}

	alert := &FraudAlert{
		ID:             uuid.New(),
		UserID:         userID,
		AlertType:      AlertTypeAccountFraud,
		AlertLevel:     AlertLevelLow,
		Status:         AlertStatusResolved,
		Description:    "Account reinstated",
		Details:        map[string]interface{}{"reason": reason},
		RiskScore:      0,
		DetectedAt:     time.Now(),
		InvestigatedBy: &adminID,
		ActionTaken:    "Account reinstated",
		Notes:          reason,
	}
	now := time.Now()
	alert.InvestigatedAt = &now
	alert.ResolvedAt = &now

	return s.repo.CreateFraudAlert(ctx, alert)
}

func (s *Service) DetectPaymentFraud(ctx context.Context, userID uuid.UUID) error {
	indicators, err := s.repo.GetPaymentFraudIndicators(ctx, userID)
	if err != nil {
		return err
	}

	if indicators.RiskScore >= 70 {
		alert := &FraudAlert{
			ID:          uuid.New(),
			UserID:      userID,
			AlertType:   AlertTypePaymentFraud,
			AlertLevel:  s.determineAlertLevel(indicators.RiskScore),
			Status:      AlertStatusPending,
			Description: fmt.Sprintf("Payment fraud risk score: %.1f", indicators.RiskScore),
			Details: map[string]interface{}{
				"failed_attempts":          indicators.FailedPaymentAttempts,
				"chargebacks":              indicators.ChargebackCount,
				"multiple_payment_methods": indicators.MultiplePaymentMethods,
				"suspicious_transactions":  indicators.SuspiciousTransactions,
				"rapid_changes":            indicators.RapidPaymentChanges,
			},
			RiskScore:  indicators.RiskScore,
			DetectedAt: time.Now(),
		}
		return s.CreateAlert(ctx, alert)
	}

	return nil
}

func (s *Service) DetectRideFraud(ctx context.Context, userID uuid.UUID) error {
	indicators, err := s.repo.GetRideFraudIndicators(ctx, userID)
	if err != nil {
		return err
	}

	if indicators.RiskScore >= 70 {
		alert := &FraudAlert{
			ID:          uuid.New(),
			UserID:      userID,
			AlertType:   AlertTypeRideFraud,
			AlertLevel:  s.determineAlertLevel(indicators.RiskScore),
			Status:      AlertStatusPending,
			Description: fmt.Sprintf("Ride fraud risk score: %.1f", indicators.RiskScore),
			Details: map[string]interface{}{
				"excessive_cancellations": indicators.ExcessiveCancellations,
				"unusual_patterns":        indicators.UnusualRidePatterns,
				"fake_gps":                indicators.FakeGPSDetected,
				"collision":               indicators.CollisionWithDriver,
				"promo_abuse":             indicators.PromoAbuse,
			},
			RiskScore:  indicators.RiskScore,
			DetectedAt: time.Now(),
		}
		return s.CreateAlert(ctx, alert)
	}

	return nil
}

func (s *Service) GetFraudStatistics(ctx context.Context, startDate, endDate time.Time) (*FraudStatistics, error) {
	stats, err := s.repo.GetFraudStatistics(ctx, startDate, endDate)
	if err != nil {
		return nil, common.NewInternalServerError("failed to get fraud statistics")
	}
	return stats, nil
}

func (s *Service) GetFraudPatterns(ctx context.Context, limit int) ([]*FraudPattern, error) {
	patterns, err := s.repo.GetFraudPatterns(ctx, limit)
	if err != nil {
		return nil, common.NewInternalServerError("failed to get fraud patterns")
	}
	if patterns == nil {
		patterns = []*FraudPattern{}
	}
	return patterns, nil
}

func (s *Service) DetectAccountFraud(ctx context.Context, userID uuid.UUID) error {
	indicators, err := s.repo.GetAccountFraudIndicators(ctx, userID)
	if err != nil {
		return err
	}

	if indicators.RiskScore >= 70 {
		alert := &FraudAlert{
			ID:          uuid.New(),
			UserID:      userID,
			AlertType:   AlertTypeAccountFraud,
			AlertLevel:  s.determineAlertLevel(indicators.RiskScore),
			Status:      AlertStatusPending,
			Description: fmt.Sprintf("Account fraud risk score: %.1f", indicators.RiskScore),
			Details: map[string]interface{}{
				"multiple_accounts": indicators.MultipleAccountsSameDevice,
				"rapid_creation":    indicators.RapidAccountCreation,
				"suspicious_email":  indicators.SuspiciousEmailPattern,
				"fake_phone":        indicators.FakePhoneNumber,
				"vpn_usage":         indicators.VPNUsage,
			},
			RiskScore:  indicators.RiskScore,
			DetectedAt: time.Now(),
		}
		return s.CreateAlert(ctx, alert)
	}

	return nil
}

func (s *Service) determineAlertLevel(riskScore float64) FraudAlertLevel {
	if riskScore >= 90 {
		return AlertLevelCritical
	} else if riskScore >= 70 {
		return AlertLevelHigh
	} else if riskScore >= 50 {
		return AlertLevelMedium
	}
	return AlertLevelLow
}
