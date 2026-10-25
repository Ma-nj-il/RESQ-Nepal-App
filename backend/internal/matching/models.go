package matching

import (
	"time"

	"github.com/google/uuid"
)

type RideRequestedEvent struct {
	RideID            uuid.UUID `json:"ride_id"`
	RiderID           uuid.UUID `json:"rider_id"`
	RiderName         string    `json:"rider_name"`
	RiderRating       float64   `json:"rider_rating"`
	PickupLatitude    float64   `json:"pickup_latitude"`
	PickupLongitude   float64   `json:"pickup_longitude"`
	PickupAddress     string    `json:"pickup_address"`
	DropoffLatitude   *float64  `json:"dropoff_latitude,omitempty"`
	DropoffLongitude  *float64  `json:"dropoff_longitude,omitempty"`
	DropoffAddress    *string   `json:"dropoff_address,omitempty"`
	RideTypeID        uuid.UUID `json:"ride_type_id"`
	RideTypeName      string    `json:"ride_type_name"`
	EstimatedFare     float64   `json:"estimated_fare"`
	EstimatedDistance float64   `json:"estimated_distance_km"`
	EstimatedDuration int       `json:"estimated_duration_minutes"`
	Currency          string    `json:"currency"`
	RequestedAt       time.Time `json:"requested_at"`
}

type RideAcceptedEvent struct {
	RideID     uuid.UUID `json:"ride_id"`
	DriverID   uuid.UUID `json:"driver_id"`
	DriverName string    `json:"driver_name"`
	AcceptedAt time.Time `json:"accepted_at"`
}

type RideCancelledEvent struct {
	RideID      uuid.UUID `json:"ride_id"`
	CancelledBy uuid.UUID `json:"cancelled_by"`
	Reason      string    `json:"reason"`
	CancelledAt time.Time `json:"cancelled_at"`
}

type DriverLocation struct {
	UserID    uuid.UUID
	DriverID  uuid.UUID
	Latitude  float64
	Longitude float64
	Distance  float64
}

type RideOffer struct {
	RideID            uuid.UUID `json:"ride_id"`
	RiderName         string    `json:"rider_name"`
	RiderRating       float64   `json:"rider_rating"`
	PickupLocation    Location  `json:"pickup_location"`
	DropoffLocation   *Location `json:"dropoff_location,omitempty"`
	RideType          string    `json:"ride_type"`
	EstimatedFare     float64   `json:"estimated_fare"`
	EstimatedDistance float64   `json:"estimated_distance_km"`
	EstimatedDuration int       `json:"estimated_duration_minutes"`
	DistanceToPickup  float64   `json:"distance_to_pickup_km"`
	ETAToPickup       int       `json:"eta_to_pickup_minutes"`
	Currency          string    `json:"currency"`
	ExpiresAt         time.Time `json:"expires_at"`
	TimeoutSeconds    int       `json:"timeout_seconds"`
}

type Location struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Address   string  `json:"address"`
}

type OfferTracking struct {
	DriverID  uuid.UUID `json:"driver_id"`
	SentAt    time.Time `json:"sent_at"`
	ExpiresAt time.Time `json:"expires_at"`
}

type MatchingConfig struct {
	SearchRadiusKm      float64
	MaxSearchRadiusKm   float64
	RadiusIncrementKm   float64
	MaxDriversToNotify  int
	OfferTimeoutSeconds int
	RetryDelaySeconds   int
	FirstBatchSize      int
}

func DefaultMatchingConfig() MatchingConfig {
	return MatchingConfig{
		SearchRadiusKm:      5.0,
		MaxSearchRadiusKm:   20.0,
		RadiusIncrementKm:   5.0,
		MaxDriversToNotify:  10,
		OfferTimeoutSeconds: 30,
		RetryDelaySeconds:   10,
		FirstBatchSize:      3,
	}
}
