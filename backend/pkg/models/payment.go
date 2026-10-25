package models

import (
	"time"

	"github.com/google/uuid"
)

type PaymentStatus string

const (
	PaymentStatusPending   PaymentStatus = "pending"
	PaymentStatusCompleted PaymentStatus = "completed"
	PaymentStatusFailed    PaymentStatus = "failed"
	PaymentStatusRefunded  PaymentStatus = "refunded"
)

type PaymentMethod string

const (
	PaymentMethodCash PaymentMethod = "cash"
)

type Payment struct {
	ID             uuid.UUID              `json:"id" db:"id" gorm:"primaryKey;type:uuid"`
	RideID         uuid.UUID              `json:"ride_id" db:"ride_id" gorm:"type:uuid;not null"`
	RiderID        uuid.UUID              `json:"rider_id" db:"rider_id" gorm:"type:uuid;not null"`
	DriverID       uuid.UUID              `json:"driver_id" db:"driver_id" gorm:"type:uuid;not null"`
	Amount         float64                `json:"amount" db:"amount" gorm:"not null"`
	Currency       string                 `json:"currency" db:"currency" gorm:"size:10;not null"`
	PaymentMethod  string                 `json:"payment_method" db:"payment_method" gorm:"not null"`
	Status         string                 `json:"status" db:"status" gorm:"not null"`
	Metadata       map[string]interface{} `json:"metadata,omitempty" db:"metadata" gorm:"type:jsonb"`
	Commission     float64                `json:"commission" db:"commission"`
	DriverEarnings float64                `json:"driver_earnings" db:"driver_earnings"`
	Method         PaymentMethod          `json:"method" db:"method" gorm:"type:string"`
	TransactionID  *string                `json:"transaction_id,omitempty" db:"transaction_id" gorm:"uniqueIndex"`
	FailureReason  *string                `json:"failure_reason,omitempty" db:"failure_reason"`
	ProcessedAt    *time.Time             `json:"processed_at,omitempty" db:"processed_at"`
	CreatedAt      time.Time              `json:"created_at" db:"created_at" gorm:"not null"`
	UpdatedAt      time.Time              `json:"updated_at" db:"updated_at" gorm:"not null"`
}

type PaymentRequest struct {
	RideID uuid.UUID     `json:"ride_id" binding:"required"`
	Method PaymentMethod `json:"method" binding:"required,oneof=card wallet cash"`
	Token  *string       `json:"token,omitempty"`
}
