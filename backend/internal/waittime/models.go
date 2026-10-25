package waittime

import (
	"time"

	"github.com/google/uuid"
)

type WaitTimeConfig struct {
	ID              uuid.UUID `json:"id" gorm:"type:uuid;primaryKey"`
	Name            string    `json:"name" gorm:"not null"`
	FreeWaitMinutes int       `json:"free_wait_minutes" gorm:"not null;default:0"`
	ChargePerMinute float64   `json:"charge_per_minute" gorm:"not null;default:0"`
	MaxWaitMinutes  int       `json:"max_wait_minutes" gorm:"not null;default:0"`
	MaxWaitCharge   float64   `json:"max_wait_charge" gorm:"not null;default:0"`
	AppliesTo       string    `json:"applies_to" gorm:"not null"`
	IsActive        bool      `json:"is_active" gorm:"not null;default:true"`
	CreatedAt       time.Time `json:"created_at" gorm:"not null"`
	UpdatedAt       time.Time `json:"updated_at" gorm:"not null"`
}

type WaitTimeRecord struct {
	ID                uuid.UUID  `json:"id" gorm:"type:uuid;primaryKey"`
	RideID            uuid.UUID  `json:"ride_id" gorm:"type:uuid;index;not null"`
	DriverID          uuid.UUID  `json:"driver_id" gorm:"type:uuid;index;not null"`
	ConfigID          uuid.UUID  `json:"config_id" gorm:"type:uuid;not null"`
	WaitType          string     `json:"wait_type" gorm:"not null"`
	ArrivedAt         time.Time  `json:"arrived_at" gorm:"not null"`
	StartedAt         *time.Time `json:"started_at,omitempty"`
	FreeMinutes       int        `json:"free_minutes" gorm:"not null;default:0"`
	TotalWaitMinutes  float64    `json:"total_wait_minutes" gorm:"not null;default:0"`
	ChargeableMinutes float64    `json:"chargeable_minutes" gorm:"not null;default:0"`
	ChargePerMinute   float64    `json:"charge_per_minute" gorm:"not null;default:0"`
	TotalCharge       float64    `json:"total_charge" gorm:"not null;default:0"`
	WasCapped         bool       `json:"was_capped" gorm:"not null;default:false"`
	Status            string     `json:"status" gorm:"not null;default:'waiting'"`
	CreatedAt         time.Time  `json:"created_at" gorm:"not null"`
	UpdatedAt         time.Time  `json:"updated_at" gorm:"not null"`
}

type WaitTimeNotification struct {
	ID          uuid.UUID `json:"id" gorm:"type:uuid;primaryKey"`
	RecordID    uuid.UUID `json:"record_id" gorm:"type:uuid;index;not null"`
	RideID      uuid.UUID `json:"ride_id" gorm:"type:uuid;index;not null"`
	RiderID     uuid.UUID `json:"rider_id" gorm:"type:uuid;index;not null"`
	MinutesMark int       `json:"minutes_mark" gorm:"not null"`
	Message     string    `json:"message" gorm:"not null"`
	SentAt      time.Time `json:"sent_at" gorm:"not null"`
}

type StartWaitRequest struct {
	RideID   uuid.UUID `json:"ride_id" binding:"required"`
	WaitType string    `json:"wait_type" binding:"required"`
}

type StopWaitRequest struct {
	RideID uuid.UUID `json:"ride_id" binding:"required"`
}

type WaiveChargeRequest struct {
	RecordID uuid.UUID `json:"record_id" binding:"required"`
	Reason   string    `json:"reason" binding:"required"`
}

type WaitTimeSummary struct {
	RideID             uuid.UUID        `json:"ride_id"`
	Records            []WaitTimeRecord `json:"records"`
	TotalWaitMinutes   float64          `json:"total_wait_minutes"`
	TotalChargeableMin float64          `json:"total_chargeable_minutes"`
	TotalCharge        float64          `json:"total_charge"`
	HasActiveWait      bool             `json:"has_active_wait"`
}

type CreateConfigRequest struct {
	Name            string  `json:"name" binding:"required"`
	FreeWaitMinutes int     `json:"free_wait_minutes" binding:"required"`
	ChargePerMinute float64 `json:"charge_per_minute" binding:"required"`
	MaxWaitMinutes  int     `json:"max_wait_minutes" binding:"required"`
	MaxWaitCharge   float64 `json:"max_wait_charge" binding:"required"`
	AppliesTo       string  `json:"applies_to" binding:"required"`
}
