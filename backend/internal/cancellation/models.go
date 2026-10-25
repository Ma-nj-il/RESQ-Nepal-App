package cancellation

import (
	"time"

	"github.com/google/uuid"
)

type CancelledBy string

const (
	CancelledByRider  CancelledBy = "rider"
	CancelledByDriver CancelledBy = "driver"
	CancelledBySystem CancelledBy = "system"
)

type CancellationReasonCode string

const (
	ReasonRiderChangedMind   CancellationReasonCode = "changed_mind"
	ReasonRiderDriverTooFar  CancellationReasonCode = "driver_too_far"
	ReasonRiderWaitTooLong   CancellationReasonCode = "wait_too_long"
	ReasonRiderWrongLocation CancellationReasonCode = "wrong_location"
	ReasonRiderPriceChanged  CancellationReasonCode = "price_changed"
	ReasonRiderFoundOther    CancellationReasonCode = "found_other_ride"
	ReasonRiderEmergency     CancellationReasonCode = "emergency"
	ReasonRiderOther         CancellationReasonCode = "other"
)

const (
	ReasonDriverRiderNoShow      CancellationReasonCode = "rider_no_show"
	ReasonDriverRiderUnreachable CancellationReasonCode = "rider_unreachable"
	ReasonDriverVehicleIssue     CancellationReasonCode = "vehicle_issue"
	ReasonDriverUnsafePickup     CancellationReasonCode = "unsafe_pickup"
	ReasonDriverTooFar           CancellationReasonCode = "too_far"
	ReasonDriverEmergency        CancellationReasonCode = "driver_emergency"
	ReasonDriverOther            CancellationReasonCode = "driver_other"
)

const (
	ReasonSystemNoDriver    CancellationReasonCode = "no_driver_found"
	ReasonSystemTimeout     CancellationReasonCode = "request_timeout"
	ReasonSystemPaymentFail CancellationReasonCode = "payment_failed"
	ReasonSystemFraud       CancellationReasonCode = "fraud_detected"
)

type FeeWaiverReason string

const (
	WaiverFreeCancellationWindow FeeWaiverReason = "free_cancellation_window"
	WaiverDriverFault            FeeWaiverReason = "driver_fault"
	WaiverSystemIssue            FeeWaiverReason = "system_issue"
	WaiverFirstCancellation      FeeWaiverReason = "first_cancellation"
	WaiverAdminOverride          FeeWaiverReason = "admin_override"
	WaiverPromoExemption         FeeWaiverReason = "promo_exemption"
)

type CancellationRecord struct {
	ID                  uuid.UUID              `json:"id" gorm:"type:uuid;primaryKey"`
	RideID              uuid.UUID              `json:"ride_id" gorm:"type:uuid;index"`
	RiderID             uuid.UUID              `json:"rider_id" gorm:"type:uuid;index"`
	DriverID            *uuid.UUID             `json:"driver_id,omitempty" gorm:"type:uuid;index"`
	CancelledBy         CancelledBy            `json:"cancelled_by" gorm:"not null"`
	ReasonCode          CancellationReasonCode `json:"reason_code" gorm:"not null"`
	ReasonText          *string                `json:"reason_text,omitempty"`
	FeeAmount           float64                `json:"fee_amount" gorm:"not null;default:0"`
	FeeWaived           bool                   `json:"fee_waived" gorm:"not null;default:false"`
	WaiverReason        *FeeWaiverReason       `json:"waiver_reason,omitempty"`
	MinutesSinceRequest float64                `json:"minutes_since_request" gorm:"not null"`
	MinutesSinceAccept  *float64               `json:"minutes_since_accept,omitempty"`
	RideStatus          string                 `json:"ride_status_at_cancel" gorm:"column:ride_status_at_cancel;not null"`
	PickupLatitude      float64                `json:"pickup_latitude" gorm:"not null"`
	PickupLongitude     float64                `json:"pickup_longitude" gorm:"not null"`
	CancelledAt         time.Time              `json:"cancelled_at" gorm:"not null"`
	CreatedAt           time.Time              `json:"created_at" gorm:"not null"`
}

type CancellationPolicy struct {
	ID                      uuid.UUID `json:"id" gorm:"type:uuid;primaryKey"`
	Name                    string    `json:"name" gorm:"not null"`
	FreeCancelWindowMinutes int       `json:"free_cancel_window_minutes" gorm:"not null"`
	MaxFreeCancelsPerDay    int       `json:"max_free_cancels_per_day" gorm:"not null"`
	MaxFreeCancelsPerWeek   int       `json:"max_free_cancels_per_week" gorm:"not null"`
	DriverNoShowMinutes     int       `json:"driver_no_show_minutes" gorm:"not null"`
	RiderNoShowMinutes      int       `json:"rider_no_show_minutes" gorm:"not null"`
	DriverPenaltyThreshold  int       `json:"driver_penalty_threshold" gorm:"not null"`
	RiderPenaltyThreshold   int       `json:"rider_penalty_threshold" gorm:"not null"`
	IsDefault               bool      `json:"is_default" gorm:"not null;default:false"`
	IsActive                bool      `json:"is_active" gorm:"not null;default:true"`
	CreatedAt               time.Time `json:"created_at" gorm:"not null"`
	UpdatedAt               time.Time `json:"updated_at" gorm:"not null"`
}

type UserCancellationStats struct {
	UserID                 uuid.UUID  `json:"user_id"`
	TotalCancellations     int        `json:"total_cancellations"`
	CancellationsToday     int        `json:"cancellations_today"`
	CancellationsThisWeek  int        `json:"cancellations_this_week"`
	CancellationsThisMonth int        `json:"cancellations_this_month"`
	TotalFeesCharged       float64    `json:"total_fees_charged"`
	TotalFeesWaived        float64    `json:"total_fees_waived"`
	CancellationRate       float64    `json:"cancellation_rate"`
	LastCancellationAt     *time.Time `json:"last_cancellation_at,omitempty"`
	IsWarned               bool       `json:"is_warned"`
	IsPenalized            bool       `json:"is_penalized"`
}

type CancellationFeeResult struct {
	FeeAmount    float64          `json:"fee_amount"`
	FeeWaived    bool             `json:"fee_waived"`
	WaiverReason *FeeWaiverReason `json:"waiver_reason,omitempty"`
	Explanation  string           `json:"explanation"`
}

type TopCancellationReason struct {
	ReasonCode CancellationReasonCode `json:"reason_code"`
	Count      int                    `json:"count"`
	Percentage float64                `json:"percentage"`
}

type CancelRideRequest struct {
	ReasonCode CancellationReasonCode `json:"reason_code" binding:"required"`
	ReasonText *string                `json:"reason_text,omitempty"`
}

type CancellationPreviewResponse struct {
	FeeAmount            float64  `json:"fee_amount"`
	FeeWaived            bool     `json:"fee_waived"`
	WaiverReason         *string  `json:"waiver_reason,omitempty"`
	Explanation          string   `json:"explanation"`
	FreeCancelsRemaining int      `json:"free_cancels_remaining"`
	MinutesSinceRequest  float64  `json:"minutes_since_request"`
	MinutesSinceAccept   *float64 `json:"minutes_since_accept,omitempty"`
}

type CancelRideResponse struct {
	RideID       uuid.UUID `json:"ride_id"`
	CancelledBy  string    `json:"cancelled_by"`
	FeeAmount    float64   `json:"fee_amount"`
	FeeWaived    bool      `json:"fee_waived"`
	WaiverReason *string   `json:"waiver_reason,omitempty"`
	Explanation  string    `json:"explanation"`
	CancelledAt  time.Time `json:"cancelled_at"`
}

type WaiveFeeRequest struct {
	Reason string `json:"reason" binding:"required"`
}

type CancellationStatsResponse struct {
	TotalCancellations     int                     `json:"total_cancellations"`
	RiderCancellations     int                     `json:"rider_cancellations"`
	DriverCancellations    int                     `json:"driver_cancellations"`
	SystemCancellations    int                     `json:"system_cancellations"`
	TotalFeesCollected     float64                 `json:"total_fees_collected"`
	TotalFeesWaived        float64                 `json:"total_fees_waived"`
	AverageMinutesToCancel float64                 `json:"average_minutes_to_cancel"`
	CancellationRate       float64                 `json:"cancellation_rate"`
	TopReasons             []TopCancellationReason `json:"top_reasons"`
}

type CancellationReasonsResponse struct {
	Reasons []CancellationReasonOption `json:"reasons"`
}

type CancellationReasonOption struct {
	Code        CancellationReasonCode `json:"code"`
	Label       string                 `json:"label"`
	Description string                 `json:"description"`
}
