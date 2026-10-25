package models

import (
	"time"

	"github.com/google/uuid"
)

// NotificationType represents the type of notification
type NotificationType string

const (
	NotificationTypeRideRequest   NotificationType = "ride_request"
	NotificationTypeRideAccepted  NotificationType = "ride_accepted"
	NotificationTypeRideStarted   NotificationType = "ride_started"
	NotificationTypeRideCompleted NotificationType = "ride_completed"
	NotificationTypeRideCancelled NotificationType = "ride_cancelled"
	NotificationTypePayment       NotificationType = "payment"
	NotificationTypePromotion     NotificationType = "promotion"
)

// NotificationChannel represents the delivery channel
type NotificationChannel string

const (
	NotificationChannelPush  NotificationChannel = "push"
	NotificationChannelSMS   NotificationChannel = "sms"
	NotificationChannelEmail NotificationChannel = "email"
)

// Notification represents a notification
type Notification struct {
	ID           uuid.UUID              `json:"id" db:"id" gorm:"primaryKey;type:uuid"`
	UserID       uuid.UUID              `json:"user_id" db:"user_id" gorm:"type:uuid;index;not null"`
	Type         string                 `json:"type" db:"type" gorm:"type:string;not null"`
	Channel      string                 `json:"channel" db:"channel" gorm:"type:string;not null"`
	Title        string                 `json:"title" db:"title" gorm:"not null"`
	Body         string                 `json:"body" db:"body" gorm:"not null"`
	Data         map[string]interface{} `json:"data,omitempty" db:"data" gorm:"type:jsonb"`
	Status       string                 `json:"status" db:"status" gorm:"default:'pending'"`
	ScheduledAt  *time.Time             `json:"scheduled_at,omitempty" db:"scheduled_at"`
	SentAt       *time.Time             `json:"sent_at,omitempty" db:"sent_at"`
	ReadAt       *time.Time             `json:"read_at,omitempty" db:"read_at"`
	ErrorMessage *string                `json:"error_message,omitempty" db:"error_message"`
	IsRead       bool                   `json:"is_read" db:"is_read" gorm:"default:false"`
	CreatedAt    time.Time              `json:"created_at" db:"created_at"`
	UpdatedAt    time.Time              `json:"updated_at" db:"updated_at"`
}

// NotificationRequest represents a request to send a notification
type NotificationRequest struct {
	UserID  uuid.UUID           `json:"user_id" binding:"required"`
	Type    NotificationType    `json:"type" binding:"required"`
	Channel NotificationChannel `json:"channel" binding:"required"`
	Title   string              `json:"title" binding:"required"`
	Body    string              `json:"body" binding:"required"`
	Data    map[string]string   `json:"data,omitempty"`
}
