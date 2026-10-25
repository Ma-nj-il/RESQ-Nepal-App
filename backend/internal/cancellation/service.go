package cancellation

import (
	"context"
	"fmt"
	"time"

	"github.com/bikky-kc013/medi-ambulance/internal/pricing"
	"github.com/bikky-kc013/medi-ambulance/pkg/common"
	"github.com/bikky-kc013/medi-ambulance/pkg/database"
	"github.com/bikky-kc013/medi-ambulance/pkg/models"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

var defaultPolicy = CancellationPolicy{
	FreeCancelWindowMinutes: 2,
	MaxFreeCancelsPerDay:    3,
	MaxFreeCancelsPerWeek:   10,
	DriverNoShowMinutes:     5,
	RiderNoShowMinutes:      5,
	DriverPenaltyThreshold:  20,
	RiderPenaltyThreshold:   30,
}

type Service struct {
	repo *Repository
	db   *database.DBPool
}

func NewService(repo *Repository, db *database.DBPool) *Service {
	return &Service{repo: repo, db: db}
}

func (s *Service) PreviewCancellation(ctx context.Context, rideID, userID uuid.UUID) (*CancellationPreviewResponse, error) {
	ride, err := s.getRide(ctx, rideID)
	if err != nil {
		return nil, common.NewNotFoundError("ride not found", nil)
	}

	isRider := ride.RiderID == userID
	isDriver := ride.DriverID != nil && *ride.DriverID == userID
	if !isRider && !isDriver {
		return nil, common.NewForbiddenError("not authorized for this ride")
	}

	if ride.Status == models.RideStatusCompleted || ride.Status == models.RideStatusCancelled {
		return nil, common.NewBadRequestError("ride already completed or cancelled", nil)
	}

	cancelledBy := CancelledByRider
	if isDriver {
		cancelledBy = CancelledByDriver
	}

	policy := s.getPolicy(ctx)
	minutesSinceRequest := time.Since(ride.CreatedAt).Minutes()

	var minutesSinceAccept *float64
	if ride.AcceptedAt != nil {
		m := time.Since(*ride.AcceptedAt).Minutes()
		minutesSinceAccept = &m
	}

	feeResult := s.calculateFee(ctx, userID, cancelledBy, minutesSinceRequest, ride, policy)

	freeCancelsToday, _ := s.repo.CountUserCancellationsToday(ctx, userID, cancelledBy)
	remaining := policy.MaxFreeCancelsPerDay - freeCancelsToday
	if remaining < 0 {
		remaining = 0
	}

	var waiverStr *string
	if feeResult.WaiverReason != nil {
		s := string(*feeResult.WaiverReason)
		waiverStr = &s
	}

	return &CancellationPreviewResponse{
		FeeAmount:            feeResult.FeeAmount,
		FeeWaived:            feeResult.FeeWaived,
		WaiverReason:         waiverStr,
		Explanation:          feeResult.Explanation,
		FreeCancelsRemaining: remaining,
		MinutesSinceRequest:  minutesSinceRequest,
		MinutesSinceAccept:   minutesSinceAccept,
	}, nil
}

func (s *Service) CancelRide(ctx context.Context, rideID, userID uuid.UUID, req *CancelRideRequest) (*CancelRideResponse, error) {
	ride, err := s.getRide(ctx, rideID)
	if err != nil {
		return nil, common.NewNotFoundError("ride not found", nil)
	}

	isRider := ride.RiderID == userID
	isDriver := ride.DriverID != nil && *ride.DriverID == userID
	if !isRider && !isDriver {
		return nil, common.NewForbiddenError("not authorized to cancel this ride")
	}

	if ride.Status == models.RideStatusCompleted || ride.Status == models.RideStatusCancelled {
		return nil, common.NewBadRequestError("ride already completed or cancelled", nil)
	}

	cancelledBy := CancelledByRider
	if isDriver {
		cancelledBy = CancelledByDriver
	}

	policy := s.getPolicy(ctx)
	now := time.Now()
	minutesSinceRequest := now.Sub(ride.CreatedAt).Minutes()

	var minutesSinceAccept *float64
	if ride.AcceptedAt != nil {
		m := now.Sub(*ride.AcceptedAt).Minutes()
		minutesSinceAccept = &m
	}

	feeResult := s.calculateFee(ctx, userID, cancelledBy, minutesSinceRequest, ride, policy)

	record := &CancellationRecord{
		ID:                  uuid.New(),
		RideID:              rideID,
		RiderID:             ride.RiderID,
		DriverID:            ride.DriverID,
		CancelledBy:         cancelledBy,
		ReasonCode:          req.ReasonCode,
		ReasonText:          req.ReasonText,
		FeeAmount:           feeResult.FeeAmount,
		FeeWaived:           feeResult.FeeWaived,
		WaiverReason:        feeResult.WaiverReason,
		MinutesSinceRequest: minutesSinceRequest,
		MinutesSinceAccept:  minutesSinceAccept,
		RideStatus:          string(ride.Status),
		PickupLatitude:      ride.PickupLatitude,
		PickupLongitude:     ride.PickupLongitude,
		CancelledAt:         now,
		CreatedAt:           now,
	}

	if err := s.repo.CreateCancellationRecord(ctx, record); err != nil {
		return nil, fmt.Errorf("create cancellation record: %w", err)
	}

	err = s.db.Primary.WithContext(ctx).Table("rides").
		Where("id = ?", rideID).
		Updates(map[string]interface{}{
			"status":              models.RideStatusCancelled,
			"cancelled_at":        now,
			"cancellation_reason": string(req.ReasonCode),
			"updated_at":          now,
		}).Error

	if err != nil {
		return nil, fmt.Errorf("update ride status: %w", err)
	}

	var waiverStr *string
	if feeResult.WaiverReason != nil {
		ws := string(*feeResult.WaiverReason)
		waiverStr = &ws
	}

	return &CancelRideResponse{
		RideID:       rideID,
		CancelledBy:  string(cancelledBy),
		FeeAmount:    feeResult.FeeAmount,
		FeeWaived:    feeResult.FeeWaived,
		WaiverReason: waiverStr,
		Explanation:  feeResult.Explanation,
		CancelledAt:  now,
	}, nil
}

func (s *Service) GetCancellationDetails(ctx context.Context, rideID, userID uuid.UUID) (*CancellationRecord, error) {
	ride, err := s.getRide(ctx, rideID)
	if err != nil {
		return nil, common.NewNotFoundError("ride not found", nil)
	}

	isRider := ride.RiderID == userID
	isDriver := ride.DriverID != nil && *ride.DriverID == userID
	if !isRider && !isDriver {
		return nil, common.NewForbiddenError("not authorized to view this cancellation")
	}

	rec, err := s.repo.GetCancellationByRideID(ctx, rideID)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, common.NewNotFoundError("cancellation record not found", nil)
		}
		return nil, err
	}
	return rec, nil
}

func (s *Service) GetMyCancellationStats(ctx context.Context, userID uuid.UUID) (*UserCancellationStats, error) {
	stats, err := s.repo.GetUserCancellationStats(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("get user cancellation stats: %w", err)
	}

	policy := s.getPolicy(ctx)
	stats.IsWarned = stats.CancellationsThisWeek >= policy.RiderPenaltyThreshold/2
	stats.IsPenalized = stats.CancellationsThisWeek >= policy.RiderPenaltyThreshold

	return stats, nil
}

func (s *Service) GetMyCancellationHistory(ctx context.Context, userID uuid.UUID, limit, offset int) ([]CancellationRecord, int, error) {
	if limit < 1 || limit > 50 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	return s.repo.GetUserCancellationHistory(ctx, userID, limit, offset)
}

func (s *Service) GetCancellationReasons(isDriver bool) *CancellationReasonsResponse {
	if isDriver {
		return &CancellationReasonsResponse{
			Reasons: []CancellationReasonOption{
				{Code: ReasonDriverRiderNoShow, Label: "Rider didn't show up", Description: "The rider was not at the pickup location"},
				{Code: ReasonDriverRiderUnreachable, Label: "Can't reach rider", Description: "Unable to contact the rider by phone or chat"},
				{Code: ReasonDriverVehicleIssue, Label: "Vehicle issue", Description: "My vehicle has a mechanical problem"},
				{Code: ReasonDriverUnsafePickup, Label: "Unsafe pickup location", Description: "The pickup location is unsafe or inaccessible"},
				{Code: ReasonDriverTooFar, Label: "Too far away", Description: "The pickup location is too far from my current location"},
				{Code: ReasonDriverEmergency, Label: "Emergency", Description: "I have a personal emergency"},
				{Code: ReasonDriverOther, Label: "Other reason", Description: "Another reason not listed above"},
			},
		}
	}

	return &CancellationReasonsResponse{
		Reasons: []CancellationReasonOption{
			{Code: ReasonRiderChangedMind, Label: "Changed my mind", Description: "I no longer need a ride"},
			{Code: ReasonRiderDriverTooFar, Label: "Driver is too far", Description: "The driver is taking too long to arrive"},
			{Code: ReasonRiderWaitTooLong, Label: "Wait time too long", Description: "I've been waiting too long for a match"},
			{Code: ReasonRiderWrongLocation, Label: "Wrong pickup location", Description: "I set the wrong pickup or destination"},
			{Code: ReasonRiderPriceChanged, Label: "Price changed", Description: "The fare is higher than expected"},
			{Code: ReasonRiderFoundOther, Label: "Found another ride", Description: "I found another way to get there"},
			{Code: ReasonRiderEmergency, Label: "Emergency", Description: "I have a personal emergency"},
			{Code: ReasonRiderOther, Label: "Other reason", Description: "Another reason not listed above"},
		},
	}
}

func (s *Service) WaiveFee(ctx context.Context, cancellationID uuid.UUID, reason string) error {
	_, err := s.repo.GetCancellationByID(ctx, cancellationID)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return common.NewNotFoundError("cancellation not found", nil)
		}
		return err
	}
	return s.repo.WaiveCancellationFee(ctx, cancellationID, reason)
}

func (s *Service) GetCancellationStats(ctx context.Context, from, to time.Time) (*CancellationStatsResponse, error) {
	return s.repo.GetCancellationStats(ctx, from, to)
}

func (s *Service) GetUserCancellationStats(ctx context.Context, userID uuid.UUID) (*UserCancellationStats, error) {
	return s.repo.GetUserCancellationStats(ctx, userID)
}

func (s *Service) calculateFee(ctx context.Context, userID uuid.UUID, cancelledBy CancelledBy, minutesSinceRequest float64, ride *models.Ride, policy *CancellationPolicy) *CancellationFeeResult {
	if cancelledBy == CancelledByDriver {
		return &CancellationFeeResult{
			FeeAmount:    0,
			FeeWaived:    true,
			WaiverReason: waivePtr(WaiverDriverFault),
			Explanation:  "Driver cancellations are not charged a fee",
		}
	}

	if minutesSinceRequest < float64(policy.FreeCancelWindowMinutes) {
		return &CancellationFeeResult{
			FeeAmount:    0,
			FeeWaived:    true,
			WaiverReason: waivePtr(WaiverFreeCancellationWindow),
			Explanation:  fmt.Sprintf("Free cancellation within %d minutes of requesting", policy.FreeCancelWindowMinutes),
		}
	}

	if ride.Status == models.RideStatusRequested {
		return &CancellationFeeResult{
			FeeAmount:    0,
			FeeWaived:    true,
			WaiverReason: waivePtr(WaiverFreeCancellationWindow),
			Explanation:  "No fee when ride hasn't been accepted yet",
		}
	}

	fee := pricing.GetCancellationFee(&pricing.DefaultPricing, minutesSinceRequest, ride.EstimatedFare)

	todayCancels, _ := s.repo.CountUserCancellationsToday(ctx, userID, cancelledBy)
	if todayCancels < policy.MaxFreeCancelsPerDay {
		weekCancels, _ := s.repo.CountUserCancellationsThisWeek(ctx, userID, cancelledBy)
		if weekCancels < policy.MaxFreeCancelsPerWeek {
			return &CancellationFeeResult{
				FeeAmount:    fee,
				FeeWaived:    true,
				WaiverReason: waivePtr(WaiverFirstCancellation),
				Explanation:  fmt.Sprintf("Free cancellation (%d of %d daily limit used)", todayCancels+1, policy.MaxFreeCancelsPerDay),
			}
		}
	}

	return &CancellationFeeResult{
		FeeAmount:   fee,
		FeeWaived:   false,
		Explanation: fmt.Sprintf("Cancellation fee of %.2f applied (cancelled after %d minutes, daily free limit exceeded)", fee, int(minutesSinceRequest)),
	}
}

func (s *Service) getPolicy(ctx context.Context) *CancellationPolicy {
	policy, err := s.repo.GetDefaultPolicy(ctx)
	if err != nil {
		return &defaultPolicy
	}
	return policy
}

func (s *Service) getRide(ctx context.Context, rideID uuid.UUID) (*models.Ride, error) {
	var ride models.Ride
	err := s.db.Primary.WithContext(ctx).First(&ride, "id = ?", rideID).Error
	if err != nil {
		return nil, err
	}
	return &ride, nil
}

func waivePtr(r FeeWaiverReason) *FeeWaiverReason {
	return &r
}
