package ridehistory

import (
	"time"

	"github.com/google/uuid"
)

// RideHistoryEntry represents a past ride with full details
type RideHistoryEntry struct {
	ID       uuid.UUID  `json:"id" gorm:"type:uuid;primaryKey"`
	RiderID  uuid.UUID  `json:"rider_id" gorm:"type:uuid;index"`
	DriverID *uuid.UUID `json:"driver_id,omitempty" gorm:"type:uuid;index"`
	Status   string     `json:"status" gorm:"not null"`

	// Route
	PickupAddress    string  `json:"pickup_address" gorm:"not null"`
	PickupLatitude   float64 `json:"pickup_latitude" gorm:"not null"`
	PickupLongitude  float64 `json:"pickup_longitude" gorm:"not null"`
	DropoffAddress   string  `json:"dropoff_address" gorm:"not null"`
	DropoffLatitude  float64 `json:"dropoff_latitude" gorm:"not null"`
	DropoffLongitude float64 `json:"dropoff_longitude" gorm:"not null"`
	Distance         float64 `json:"distance_km" gorm:"column:distance;not null"`
	Duration         int     `json:"duration_minutes" gorm:"column:duration;not null"`

	// Pricing
	EstimatedFare   float64  `json:"estimated_fare" gorm:"not null"`
	FinalFare       *float64 `json:"final_fare,omitempty"`
	SurgeMultiplier float64  `json:"surge_multiplier" gorm:"not null;default:1"`
	DiscountAmount  float64  `json:"discount_amount" gorm:"not null;default:0"`
	Currency        string   `json:"currency" gorm:"column:currency_code;not null;default:'USD'"`

	// Rating
	Rating   *int    `json:"rating,omitempty"`
	Feedback *string `json:"feedback,omitempty"`

	// Cancellation
	CancellationReason *string `json:"cancellation_reason,omitempty"`

	// Timestamps
	RequestedAt time.Time  `json:"requested_at" gorm:"not null"`
	AcceptedAt  *time.Time `json:"accepted_at,omitempty"`
	StartedAt   *time.Time `json:"started_at,omitempty"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
	CancelledAt *time.Time `json:"cancelled_at,omitempty"`
}

func (RideHistoryEntry) TableName() string {
	return "rides" // Ride history uses the same table as active rides
}

// Receipt represents a detailed ride receipt
type Receipt struct {
	ReceiptID  string    `json:"receipt_id"`
	RideID     uuid.UUID `json:"ride_id"`
	IssuedAt   time.Time `json:"issued_at"`
	RiderName  string    `json:"rider_name"`
	RiderEmail *string   `json:"rider_email,omitempty"`

	// Trip summary
	PickupAddress  string  `json:"pickup_address"`
	DropoffAddress string  `json:"dropoff_address"`
	Distance       float64 `json:"distance_km"`
	Duration       int     `json:"duration_minutes"`
	TripDate       string  `json:"trip_date"`
	TripStartTime  string  `json:"trip_start_time"`
	TripEndTime    string  `json:"trip_end_time"`

	// Fare breakdown
	FareBreakdown []FareLineItem `json:"fare_breakdown"`
	Subtotal      float64        `json:"subtotal"`
	Discounts     float64        `json:"discounts"`
	Fees          float64        `json:"fees"`
	Tip           float64        `json:"tip"`
	Total         float64        `json:"total"`
	Currency      string         `json:"currency"`

	// Payment
	PaymentMethod string  `json:"payment_method"`
	PaymentLast4  *string `json:"payment_last4,omitempty"`

	// Driver
	DriverName   *string `json:"driver_name,omitempty"`
	VehicleInfo  *string `json:"vehicle_info,omitempty"`
	LicensePlate *string `json:"license_plate,omitempty"`

	// Map
	RouteMapURL *string `json:"route_map_url,omitempty"`
}

// FareLineItem represents a line in the fare breakdown
type FareLineItem struct {
	Label  string  `json:"label"`
	Amount float64 `json:"amount"`
	Type   string  `json:"type"` // charge, discount, fee, tip
}

// ========================================
// REQUEST/RESPONSE TYPES
// ========================================

// HistoryFilters filters ride history
type HistoryFilters struct {
	Status   *string    `json:"status,omitempty"`
	FromDate *time.Time `json:"from_date,omitempty"`
	ToDate   *time.Time `json:"to_date,omitempty"`
	MinFare  *float64   `json:"min_fare,omitempty"`
	MaxFare  *float64   `json:"max_fare,omitempty"`
}

// RideStats summarizes a user's ride activity
type RideStats struct {
	TotalRides      int     `json:"total_rides"`
	CompletedRides  int     `json:"completed_rides"`
	CancelledRides  int     `json:"cancelled_rides"`
	TotalSpent      float64 `json:"total_spent"`
	TotalDistance   float64 `json:"total_distance_km"`
	TotalDuration   int     `json:"total_duration_minutes"`
	AverageFare     float64 `json:"average_fare"`
	AverageDistance float64 `json:"average_distance_km"`
	AverageRating   float64 `json:"average_rating_given"`
	FavoritePickup  *string `json:"favorite_pickup,omitempty"`
	FavoriteDropoff *string `json:"favorite_dropoff,omitempty"`
	Currency        string  `json:"currency"`
	Period          string  `json:"period"`
}

// FrequentRoute represents a commonly taken route
type FrequentRoute struct {
	PickupAddress  string  `json:"pickup_address"`
	DropoffAddress string  `json:"dropoff_address"`
	RideCount      int     `json:"ride_count"`
	AverageFare    float64 `json:"average_fare"`
	LastRideAt     string  `json:"last_ride_at"`
}
