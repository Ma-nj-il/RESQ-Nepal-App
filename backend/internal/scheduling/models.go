package scheduling

import (
	"time"

	"github.com/google/uuid"
)

// RecurrencePattern represents how often a ride repeats
type RecurrencePattern string

const (
	RecurrenceDaily      RecurrencePattern = "daily"
	RecurrenceWeekdays   RecurrencePattern = "weekdays"   // Mon-Fri
	RecurrenceWeekends   RecurrencePattern = "weekends"   // Sat-Sun
	RecurrenceWeekly     RecurrencePattern = "weekly"     // Same day each week
	RecurrenceBiweekly   RecurrencePattern = "biweekly"   // Every 2 weeks
	RecurrenceMonthly    RecurrencePattern = "monthly"    // Same day each month
	RecurrenceCustom     RecurrencePattern = "custom"     // Specific days
)

// ScheduleStatus represents the status of a recurring schedule
type ScheduleStatus string

const (
	ScheduleStatusActive    ScheduleStatus = "active"
	ScheduleStatusPaused    ScheduleStatus = "paused"
	ScheduleStatusCancelled ScheduleStatus = "cancelled"
	ScheduleStatusExpired   ScheduleStatus = "expired"
)

// InstanceStatus represents the status of a scheduled ride instance
type InstanceStatus string

const (
	InstanceStatusScheduled  InstanceStatus = "scheduled"
	InstanceStatusConfirmed  InstanceStatus = "confirmed"
	InstanceStatusInProgress InstanceStatus = "in_progress"
	InstanceStatusCompleted  InstanceStatus = "completed"
	InstanceStatusCancelled  InstanceStatus = "cancelled"
	InstanceStatusSkipped    InstanceStatus = "skipped"
	InstanceStatusFailed     InstanceStatus = "failed"
)

// RecurringRide represents a recurring ride schedule
type RecurringRide struct {
	ID               uuid.UUID         `json:"id" db:"id"`
	RiderID          uuid.UUID         `json:"rider_id" db:"rider_id"`
	Name             string            `json:"name" db:"name"` // e.g., "Morning Commute"

	// Route
	PickupLocation   Location          `json:"pickup_location"`
	DropoffLocation  Location          `json:"dropoff_location"`
	PickupAddress    string            `json:"pickup_address" db:"pickup_address"`
	DropoffAddress   string            `json:"dropoff_address" db:"dropoff_address"`

	// Ride preferences
	RideType         string            `json:"ride_type" db:"ride_type"` // economy, premium, etc.
	Notes            *string           `json:"notes,omitempty" db:"notes"`

	// Schedule
	RecurrencePattern RecurrencePattern `json:"recurrence_pattern" db:"recurrence_pattern"`
	DaysOfWeek       []int             `json:"days_of_week"` // 0=Sunday, 1=Monday, etc.
	ScheduledTime    string            `json:"scheduled_time" db:"scheduled_time"` // "08:30" in 24h format
	Timezone         string            `json:"timezone" db:"timezone"`

	// Date range
	StartDate        time.Time         `json:"start_date" db:"start_date"`
	EndDate          *time.Time        `json:"end_date,omitempty" db:"end_date"` // nil = no end
	MaxOccurrences   *int              `json:"max_occurrences,omitempty" db:"max_occurrences"`
	OccurrenceCount  int               `json:"occurrence_count" db:"occurrence_count"`

	// Pricing
	PriceLockEnabled bool              `json:"price_lock_enabled" db:"price_lock_enabled"`
	LockedPrice      *float64          `json:"locked_price,omitempty" db:"locked_price"`
	PriceLockExpiry  *time.Time        `json:"price_lock_expiry,omitempty" db:"price_lock_expiry"`

	// Driver preference
	PreferredDriverID *uuid.UUID       `json:"preferred_driver_id,omitempty" db:"preferred_driver_id"`
	SameDriverEnabled bool             `json:"same_driver_enabled" db:"same_driver_enabled"`
	LastDriverID     *uuid.UUID        `json:"last_driver_id,omitempty" db:"last_driver_id"`

	// Notifications
	ReminderMinutes  int               `json:"reminder_minutes" db:"reminder_minutes"` // 0 = no reminder
	NotifyOnBooking  bool              `json:"notify_on_booking" db:"notify_on_booking"`
	NotifyOnCancel   bool              `json:"notify_on_cancel" db:"notify_on_cancel"`

	// Status
	Status           ScheduleStatus    `json:"status" db:"status"`
	LastScheduledAt  *time.Time        `json:"last_scheduled_at,omitempty" db:"last_scheduled_at"`
	NextScheduledAt  *time.Time        `json:"next_scheduled_at,omitempty" db:"next_scheduled_at"`

	// Corporate
	CorporateAccountID *uuid.UUID      `json:"corporate_account_id,omitempty" db:"corporate_account_id"`
	CostCenter       *string           `json:"cost_center,omitempty" db:"cost_center"`

	CreatedAt        time.Time         `json:"created_at" db:"created_at"`
	UpdatedAt        time.Time         `json:"updated_at" db:"updated_at"`
}

// Location represents a geographic point
type Location struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

// ScheduledRideInstance represents a single instance of a recurring ride
type ScheduledRideInstance struct {
	ID               uuid.UUID      `json:"id" db:"id"`
	RecurringRideID  uuid.UUID      `json:"recurring_ride_id" db:"recurring_ride_id"`
	RiderID          uuid.UUID      `json:"rider_id" db:"rider_id"`
	RideID           *uuid.UUID     `json:"ride_id,omitempty" db:"ride_id"` // Links to actual ride when booked

	// Scheduled details
	ScheduledDate    time.Time      `json:"scheduled_date" db:"scheduled_date"`
	ScheduledTime    string         `json:"scheduled_time" db:"scheduled_time"`
	PickupAt         time.Time      `json:"pickup_at" db:"pickup_at"`

	// Route (copied from recurring ride for this instance)
	PickupLocation   Location       `json:"pickup_location"`
	DropoffLocation  Location       `json:"dropoff_location"`
	PickupAddress    string         `json:"pickup_address" db:"pickup_address"`
	DropoffAddress   string         `json:"dropoff_address" db:"dropoff_address"`

	// Pricing
	EstimatedFare    float64        `json:"estimated_fare" db:"estimated_fare"`
	ActualFare       *float64       `json:"actual_fare,omitempty" db:"actual_fare"`
	PriceLocked      bool           `json:"price_locked" db:"price_locked"`

	// Driver
	DriverID         *uuid.UUID     `json:"driver_id,omitempty" db:"driver_id"`
	DriverAssignedAt *time.Time     `json:"driver_assigned_at,omitempty" db:"driver_assigned_at"`

	// Status
	Status           InstanceStatus `json:"status" db:"status"`
	StatusReason     *string        `json:"status_reason,omitempty" db:"status_reason"`

	// Timing
	ReminderSentAt   *time.Time     `json:"reminder_sent_at,omitempty" db:"reminder_sent_at"`
	BookedAt         *time.Time     `json:"booked_at,omitempty" db:"booked_at"`
	CompletedAt      *time.Time     `json:"completed_at,omitempty" db:"completed_at"`

	CreatedAt        time.Time      `json:"created_at" db:"created_at"`
	UpdatedAt        time.Time      `json:"updated_at" db:"updated_at"`
}

// FlightTracking represents flight tracking for airport rides
type FlightTracking struct {
	ID               uuid.UUID  `json:"id" db:"id"`
	RecurringRideID  *uuid.UUID `json:"recurring_ride_id,omitempty" db:"recurring_ride_id"`
	InstanceID       *uuid.UUID `json:"instance_id,omitempty" db:"instance_id"`
	RideID           *uuid.UUID `json:"ride_id,omitempty" db:"ride_id"`

	// Flight details
	FlightNumber     string     `json:"flight_number" db:"flight_number"`
	Airline          *string    `json:"airline,omitempty" db:"airline"`
	DepartureAirport *string    `json:"departure_airport,omitempty" db:"departure_airport"`
	ArrivalAirport   string     `json:"arrival_airport" db:"arrival_airport"`

	// Scheduled times
	ScheduledArrival time.Time  `json:"scheduled_arrival" db:"scheduled_arrival"`
	ActualArrival    *time.Time `json:"actual_arrival,omitempty" db:"actual_arrival"`

	// Status
	FlightStatus     string     `json:"flight_status" db:"flight_status"` // on_time, delayed, cancelled, landed
	DelayMinutes     int        `json:"delay_minutes" db:"delay_minutes"`
	LastCheckedAt    time.Time  `json:"last_checked_at" db:"last_checked_at"`

	// Auto-adjustment
	AutoAdjustPickup bool       `json:"auto_adjust_pickup" db:"auto_adjust_pickup"`
	OriginalPickupAt *time.Time `json:"original_pickup_at,omitempty" db:"original_pickup_at"`
	AdjustedPickupAt *time.Time `json:"adjusted_pickup_at,omitempty" db:"adjusted_pickup_at"`

	CreatedAt        time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at" db:"updated_at"`
}

// CalendarSync represents a calendar integration
type CalendarSync struct {
	ID               uuid.UUID  `json:"id" db:"id"`
	RiderID          uuid.UUID  `json:"rider_id" db:"rider_id"`
	Provider         string     `json:"provider" db:"provider"` // google, outlook, apple
	CalendarID       string     `json:"calendar_id" db:"calendar_id"`
	AccessToken      string     `json:"-" db:"access_token"` // Encrypted
	RefreshToken     string     `json:"-" db:"refresh_token"` // Encrypted
	ExpiresAt        time.Time  `json:"expires_at" db:"expires_at"`
	SyncEnabled      bool       `json:"sync_enabled" db:"sync_enabled"`
	LastSyncAt       *time.Time `json:"last_sync_at,omitempty" db:"last_sync_at"`
	CreatedAt        time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at" db:"updated_at"`
}

// ========================================
// REQUEST/RESPONSE TYPES
// ========================================

// CreateRecurringRideRequest represents a request to create a recurring ride
type CreateRecurringRideRequest struct {
	Name              string            `json:"name" binding:"required"`
	PickupLocation    Location          `json:"pickup_location" binding:"required"`
	DropoffLocation   Location          `json:"dropoff_location" binding:"required"`
	PickupAddress     string            `json:"pickup_address"`
	DropoffAddress    string            `json:"dropoff_address"`
	RideType          string            `json:"ride_type" binding:"required"`
	Notes             *string           `json:"notes,omitempty"`

	// Schedule
	RecurrencePattern RecurrencePattern `json:"recurrence_pattern" binding:"required"`
	DaysOfWeek        []int             `json:"days_of_week,omitempty"` // Required for weekly/custom
	ScheduledTime     string            `json:"scheduled_time" binding:"required"` // "08:30"
	Timezone          string            `json:"timezone"`

	// Date range
	StartDate         string            `json:"start_date" binding:"required"` // "2024-01-15"
	EndDate           *string           `json:"end_date,omitempty"`
	MaxOccurrences    *int              `json:"max_occurrences,omitempty"`

	// Options
	PriceLockEnabled  bool              `json:"price_lock_enabled"`
	SameDriverEnabled bool              `json:"same_driver_enabled"`
	ReminderMinutes   int               `json:"reminder_minutes"`

	// Corporate
	CostCenter        *string           `json:"cost_center,omitempty"`
}

// UpdateRecurringRideRequest represents a request to update a recurring ride
type UpdateRecurringRideRequest struct {
	Name              *string           `json:"name,omitempty"`
	ScheduledTime     *string           `json:"scheduled_time,omitempty"`
	RideType          *string           `json:"ride_type,omitempty"`
	Notes             *string           `json:"notes,omitempty"`
	DaysOfWeek        []int             `json:"days_of_week,omitempty"`
	EndDate           *string           `json:"end_date,omitempty"`
	PriceLockEnabled  *bool             `json:"price_lock_enabled,omitempty"`
	SameDriverEnabled *bool             `json:"same_driver_enabled,omitempty"`
	ReminderMinutes   *int              `json:"reminder_minutes,omitempty"`
}

// RecurringRideResponse represents a recurring ride with upcoming instances
type RecurringRideResponse struct {
	RecurringRide     *RecurringRide           `json:"recurring_ride"`
	UpcomingInstances []ScheduledRideInstance  `json:"upcoming_instances"`
	EstimatedFare     float64                  `json:"estimated_fare"`
	TotalRidesBooked  int                      `json:"total_rides_booked"`
	TotalSpent        float64                  `json:"total_spent"`
}

// SchedulePreviewRequest represents a request to preview a schedule
type SchedulePreviewRequest struct {
	RecurrencePattern RecurrencePattern `json:"recurrence_pattern" binding:"required"`
	DaysOfWeek        []int             `json:"days_of_week,omitempty"`
	ScheduledTime     string            `json:"scheduled_time" binding:"required"`
	StartDate         string            `json:"start_date" binding:"required"`
	EndDate           *string           `json:"end_date,omitempty"`
	MaxOccurrences    *int              `json:"max_occurrences,omitempty"`
}

// SchedulePreviewResponse shows upcoming dates for a schedule
type SchedulePreviewResponse struct {
	Dates []time.Time `json:"dates"`
	Count int         `json:"count"`
}

// SkipInstanceRequest represents a request to skip an instance
type SkipInstanceRequest struct {
	Reason string `json:"reason,omitempty"`
}

// RescheduleInstanceRequest represents a request to reschedule an instance
type RescheduleInstanceRequest struct {
	NewDate string `json:"new_date" binding:"required"` // "2024-01-20"
	NewTime string `json:"new_time" binding:"required"` // "09:00"
}

// FlightTrackingRequest represents a request to add flight tracking
type FlightTrackingRequest struct {
	FlightNumber     string `json:"flight_number" binding:"required"`
	ArrivalAirport   string `json:"arrival_airport" binding:"required"`
	ScheduledArrival string `json:"scheduled_arrival" binding:"required"` // ISO8601
	AutoAdjustPickup bool   `json:"auto_adjust_pickup"`
}

// RecurringRideStats represents statistics for recurring rides
type RecurringRideStats struct {
	ActiveSchedules   int     `json:"active_schedules"`
	TotalRidesBooked  int     `json:"total_rides_booked"`
	CompletedRides    int     `json:"completed_rides"`
	CancelledRides    int     `json:"cancelled_rides"`
	TotalSavings      float64 `json:"total_savings"` // From price lock
	AvgRideFrequency  float64 `json:"avg_ride_frequency"` // Rides per week
	MostCommonRoute   string  `json:"most_common_route"`
	PreferredTime     string  `json:"preferred_time"`
}
