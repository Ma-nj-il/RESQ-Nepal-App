package disputes

import (
	"time"

	"github.com/google/uuid"
)

type DisputeStatus string

const (
	DisputeStatusPending   DisputeStatus = "pending"
	DisputeStatusReviewing DisputeStatus = "reviewing"
	DisputeStatusApproved  DisputeStatus = "approved"
	DisputeStatusRejected  DisputeStatus = "rejected"
	DisputeStatusPartial   DisputeStatus = "partial_refund"
	DisputeStatusClosed    DisputeStatus = "closed"
)

type DisputeReason string

const (
	ReasonWrongRoute      DisputeReason = "wrong_route"
	ReasonOvercharged     DisputeReason = "overcharged"
	ReasonTripNotTaken    DisputeReason = "trip_not_taken"
	ReasonDriverDetour    DisputeReason = "driver_detour"
	ReasonWrongFare       DisputeReason = "wrong_fare"
	ReasonSurgeUnfair     DisputeReason = "unfair_surge"
	ReasonWaitTimeWrong   DisputeReason = "wrong_wait_time"
	ReasonCancelFeeWrong  DisputeReason = "wrong_cancel_fee"
	ReasonDuplicateCharge DisputeReason = "duplicate_charge"
	ReasonOther           DisputeReason = "other"
)

type ResolutionType string

const (
	ResolutionFullRefund    ResolutionType = "full_refund"
	ResolutionPartialRefund ResolutionType = "partial_refund"
	ResolutionCredits       ResolutionType = "credits"
	ResolutionNoAction      ResolutionType = "no_action"
	ResolutionFareAdjust    ResolutionType = "fare_adjustment"
)

type Dispute struct {
	ID             uuid.UUID       `json:"id" gorm:"type:uuid;primaryKey"`
	RideID         uuid.UUID       `json:"ride_id" gorm:"type:uuid;index"`
	UserID         uuid.UUID       `json:"user_id" gorm:"type:uuid;index"`
	DriverID       *uuid.UUID      `json:"driver_id,omitempty" gorm:"type:uuid;index"`
	DisputeNumber  string          `json:"dispute_number" gorm:"uniqueIndex;not null"`
	Reason         DisputeReason   `json:"reason" gorm:"not null"`
	Description    string          `json:"description" gorm:"not null"`
	Status         DisputeStatus   `json:"status" gorm:"not null"`
	OriginalFare   float64         `json:"original_fare" gorm:"not null"`
	DisputedAmount float64         `json:"disputed_amount" gorm:"not null"`
	RefundAmount   *float64        `json:"refund_amount,omitempty"`
	ResolutionType *ResolutionType `json:"resolution_type,omitempty"`
	ResolutionNote *string         `json:"resolution_note,omitempty"`
	ResolvedBy     *uuid.UUID      `json:"resolved_by,omitempty" gorm:"type:uuid;index"`
	Evidence       []string        `json:"evidence,omitempty" gorm:"serializer:json"`
	ResolvedAt     *time.Time      `json:"resolved_at,omitempty"`
	CreatedAt      time.Time       `json:"created_at" gorm:"not null"`
	UpdatedAt      time.Time       `json:"updated_at" gorm:"not null"`
}

type DisputeComment struct {
	ID         uuid.UUID `json:"id" gorm:"type:uuid;primaryKey"`
	DisputeID  uuid.UUID `json:"dispute_id" gorm:"type:uuid;index"`
	UserID     uuid.UUID `json:"user_id" gorm:"type:uuid;index"`
	UserRole   string    `json:"user_role" gorm:"not null"`
	Comment    string    `json:"comment" gorm:"not null"`
	IsInternal bool      `json:"is_internal" gorm:"not null;default:false"`
	CreatedAt  time.Time `json:"created_at" gorm:"not null"`
}

type RideContext struct {
	RideID            uuid.UUID  `json:"ride_id"`
	EstimatedFare     float64    `json:"estimated_fare"`
	FinalFare         *float64   `json:"final_fare,omitempty"`
	EstimatedDistance float64    `json:"estimated_distance_km"`
	ActualDistance    *float64   `json:"actual_distance_km,omitempty"`
	EstimatedDuration int        `json:"estimated_duration_min"`
	ActualDuration    *int       `json:"actual_duration_min,omitempty"`
	SurgeMultiplier   float64    `json:"surge_multiplier"`
	PickupAddress     string     `json:"pickup_address"`
	DropoffAddress    string     `json:"dropoff_address"`
	RequestedAt       time.Time  `json:"requested_at"`
	CompletedAt       *time.Time `json:"completed_at,omitempty"`
}

type DisputeSummary struct {
	ID             uuid.UUID     `json:"id"`
	DisputeNumber  string        `json:"dispute_number"`
	RideID         uuid.UUID     `json:"ride_id"`
	Reason         DisputeReason `json:"reason"`
	Status         DisputeStatus `json:"status"`
	OriginalFare   float64       `json:"original_fare"`
	DisputedAmount float64       `json:"disputed_amount"`
	RefundAmount   *float64      `json:"refund_amount,omitempty"`
	CreatedAt      time.Time     `json:"created_at"`
	UpdatedAt      time.Time     `json:"updated_at"`
}

type DisputeStats struct {
	TotalDisputes      int           `json:"total_disputes"`
	PendingDisputes    int           `json:"pending_disputes"`
	ReviewingDisputes  int           `json:"reviewing_disputes"`
	ApprovedDisputes   int           `json:"approved_disputes"`
	RejectedDisputes   int           `json:"rejected_disputes"`
	TotalRefunded      float64       `json:"total_refunded"`
	TotalDisputed      float64       `json:"total_disputed"`
	AvgResolutionHours float64       `json:"avg_resolution_hours"`
	DisputeRate        float64       `json:"dispute_rate"`
	ByReason           []ReasonCount `json:"by_reason"`
}

type ReasonCount struct {
	Reason     DisputeReason `json:"reason"`
	Count      int           `json:"count"`
	Percentage float64       `json:"percentage"`
}

type CreateDisputeRequest struct {
	RideID         uuid.UUID     `json:"ride_id" binding:"required"`
	Reason         DisputeReason `json:"reason" binding:"required"`
	Description    string        `json:"description" binding:"required,min=10,max=2000"`
	DisputedAmount float64       `json:"disputed_amount" binding:"required,gt=0"`
	Evidence       []string      `json:"evidence,omitempty"`
}

type AddCommentRequest struct {
	Comment string `json:"comment" binding:"required,min=1,max=2000"`
}

type ResolveDisputeRequest struct {
	ResolutionType ResolutionType `json:"resolution_type" binding:"required"`
	RefundAmount   *float64       `json:"refund_amount,omitempty"`
	Note           string         `json:"note" binding:"required,min=5"`
}

type DisputeDetailResponse struct {
	Dispute     *Dispute         `json:"dispute"`
	RideContext *RideContext     `json:"ride_context"`
	Comments    []DisputeComment `json:"comments"`
}

type DisputeReasonsResponse struct {
	Reasons []DisputeReasonOption `json:"reasons"`
}

type DisputeReasonOption struct {
	Code        DisputeReason `json:"code"`
	Label       string        `json:"label"`
	Description string        `json:"description"`
}
