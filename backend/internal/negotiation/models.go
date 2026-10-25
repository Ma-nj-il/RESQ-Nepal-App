package negotiation

import (
	"time"

	"github.com/google/uuid"
)

// SessionStatus represents the status of a negotiation session
type SessionStatus string

const (
	SessionStatusActive    SessionStatus = "active"
	SessionStatusAccepted  SessionStatus = "accepted"
	SessionStatusCompleted SessionStatus = "completed"
	SessionStatusExpired   SessionStatus = "expired"
	SessionStatusCancelled SessionStatus = "cancelled"
	SessionStatusNoDrivers SessionStatus = "no_drivers"
)

// OfferStatus represents the status of an offer
type OfferStatus string

const (
	OfferStatusPending    OfferStatus = "pending"
	OfferStatusAccepted   OfferStatus = "accepted"
	OfferStatusRejected   OfferStatus = "rejected"
	OfferStatusWithdrawn  OfferStatus = "withdrawn"
	OfferStatusExpired    OfferStatus = "expired"
	OfferStatusSuperseded OfferStatus = "superseded"
)

// Session represents a negotiation session
type Session struct {
	ID      uuid.UUID `json:"id" gorm:"primaryKey;type:uuid"`
	RiderID uuid.UUID `json:"rider_id" gorm:"type:uuid;index"`

	// Ride details
	PickupLatitude   float64 `json:"pickup_latitude"`
	PickupLongitude  float64 `json:"pickup_longitude"`
	PickupAddress    string  `json:"pickup_address" gorm:"type:varchar(255)"`
	DropoffLatitude  float64 `json:"dropoff_latitude"`
	DropoffLongitude float64 `json:"dropoff_longitude"`
	DropoffAddress   string  `json:"dropoff_address" gorm:"type:varchar(255)"`

	// Location context
	CountryID     *uuid.UUID `json:"country_id,omitempty" gorm:"type:uuid;index"`
	RegionID      *uuid.UUID `json:"region_id,omitempty" gorm:"type:uuid;index"`
	CityID        *uuid.UUID `json:"city_id,omitempty" gorm:"type:uuid;index"`
	PickupZoneID  *uuid.UUID `json:"pickup_zone_id,omitempty" gorm:"type:uuid;index"`
	DropoffZoneID *uuid.UUID `json:"dropoff_zone_id,omitempty" gorm:"type:uuid;index"`

	// Pricing context
	RideTypeID        *uuid.UUID `json:"ride_type_id,omitempty" gorm:"type:uuid;index"`
	CurrencyCode      string     `json:"currency_code" gorm:"type:varchar(3)"`
	EstimatedDistance float64    `json:"estimated_distance"`
	EstimatedDuration int        `json:"estimated_duration"`
	EstimatedFare     float64    `json:"estimated_fare"`

	// Fair price bounds
	FairPriceMin         float64 `json:"fair_price_min"`
	FairPriceMax         float64 `json:"fair_price_max"`
	SystemSuggestedPrice float64 `json:"system_suggested_price"`

	// Rider's initial offer
	RiderInitialOffer *float64 `json:"rider_initial_offer,omitempty"`

	// Session state
	Status           SessionStatus `json:"status" gorm:"type:varchar(20);default:'active';index"`
	AcceptedOfferID  *uuid.UUID    `json:"accepted_offer_id,omitempty" gorm:"type:uuid;index"`
	AcceptedDriverID *uuid.UUID    `json:"accepted_driver_id,omitempty" gorm:"type:uuid;index"`
	AcceptedPrice    *float64      `json:"accepted_price,omitempty"`

	// Timing
	ExpiresAt          time.Time  `json:"expires_at" gorm:"index"`
	CreatedAt          time.Time  `json:"created_at" gorm:"autoCreateTime;index"`
	AcceptedAt         *time.Time `json:"accepted_at,omitempty"`
	CompletedAt        *time.Time `json:"completed_at,omitempty"`
	CancelledAt        *time.Time `json:"cancelled_at,omitempty"`
	CancellationReason *string    `json:"cancellation_reason,omitempty" gorm:"type:text"`

	// Joined data
	Offers []*Offer `json:"offers,omitempty" gorm:"foreignKey:SessionID"`
}

// Offer represents a driver's offer in a negotiation
type Offer struct {
	ID        uuid.UUID `json:"id" gorm:"primaryKey;type:uuid"`
	SessionID uuid.UUID `json:"session_id" gorm:"type:uuid;index"`
	DriverID  uuid.UUID `json:"driver_id" gorm:"type:uuid;index"`

	// Offer details
	OfferedPrice float64 `json:"offered_price"`
	CurrencyCode string  `json:"currency_code" gorm:"type:varchar(3)"`

	// Driver context
	DriverLatitude      *float64 `json:"driver_latitude,omitempty"`
	DriverLongitude     *float64 `json:"driver_longitude,omitempty"`
	EstimatedPickupTime *int     `json:"estimated_pickup_time,omitempty"`
	DriverRating        *float64 `json:"driver_rating,omitempty"`
	DriverTotalRides    *int     `json:"driver_total_rides,omitempty"`
	VehicleModel        *string  `json:"vehicle_model,omitempty" gorm:"type:varchar(50)"`
	VehicleColor        *string  `json:"vehicle_color,omitempty" gorm:"type:varchar(20)"`

	// Offer state
	Status OfferStatus `json:"status" gorm:"type:varchar(20);default:'pending';index"`

	// Counter-offer support
	IsCounterOffer bool       `json:"is_counter_offer" gorm:"default:false"`
	ParentOfferID  *uuid.UUID `json:"parent_offer_id,omitempty" gorm:"type:uuid;index"`
	CounterBy      *string    `json:"counter_by,omitempty" gorm:"type:varchar(20)"`

	// Timing
	CreatedAt  time.Time  `json:"created_at" gorm:"autoCreateTime;index"`
	AcceptedAt *time.Time `json:"accepted_at,omitempty"`
	RejectedAt *time.Time `json:"rejected_at,omitempty"`
	ExpiredAt  *time.Time `json:"expired_at,omitempty"`
}

// Settings represents negotiation settings for a region
type Settings struct {
	ID        uuid.UUID  `json:"id" gorm:"primaryKey;type:uuid"`
	CountryID *uuid.UUID `json:"country_id,omitempty" gorm:"type:uuid;index"`
	RegionID  *uuid.UUID `json:"region_id,omitempty" gorm:"type:uuid;index"`
	CityID    *uuid.UUID `json:"city_id,omitempty" gorm:"type:uuid;index"`

	NegotiationEnabled              bool     `json:"negotiation_enabled" gorm:"default:true"`
	SessionTimeoutSeconds           int      `json:"session_timeout_seconds" gorm:"default:300"`
	MaxOffersPerSession             int      `json:"max_offers_per_session" gorm:"default:20"`
	MaxCounterOffers                int      `json:"max_counter_offers" gorm:"default:3"`
	OfferTimeoutSeconds             int      `json:"offer_timeout_seconds" gorm:"default:60"`
	MinPriceMultiplier              float64  `json:"min_price_multiplier" gorm:"default:0.7"`
	MaxPriceMultiplier              float64  `json:"max_price_multiplier" gorm:"default:1.5"`
	MaxActiveSessionsPerDriver      int      `json:"max_active_sessions_per_driver" gorm:"default:5"`
	MinDriverRatingToNegotiate      *float64 `json:"min_driver_rating_to_negotiate,omitempty"`
	MinDriverRidesToNegotiate       *int     `json:"min_driver_rides_to_negotiate,omitempty"`
	BlockDriversWithHighPriceStreak *int     `json:"block_drivers_with_high_price_streak,omitempty"`
	PriceDeviationThreshold         *float64 `json:"price_deviation_threshold,omitempty"`

	CreatedAt time.Time `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt time.Time `json:"updated_at" gorm:"autoUpdateTime"`
}

// DriverPricingStats represents a driver's pricing behavior stats
type DriverPricingStats struct {
	ID       uuid.UUID  `json:"id" gorm:"primaryKey;type:uuid"`
	DriverID uuid.UUID  `json:"driver_id" gorm:"type:uuid;index"`
	RegionID *uuid.UUID `json:"region_id,omitempty" gorm:"type:uuid;index"`
	CityID   *uuid.UUID `json:"city_id,omitempty" gorm:"type:uuid;index"`

	TotalOffers          int      `json:"total_offers" gorm:"default:0"`
	AcceptedOffers       int      `json:"accepted_offers" gorm:"default:0"`
	AverageOfferPrice    *float64 `json:"average_offer_price,omitempty"`
	AverageAcceptedPrice *float64 `json:"average_accepted_price,omitempty"`

	PriceDeviationAvg *float64 `json:"price_deviation_avg,omitempty"`
	HighPriceOffers   int      `json:"high_price_offers" gorm:"default:0"`
	LowPriceOffers    int      `json:"low_price_offers" gorm:"default:0"`

	PricingFairnessScore *float64 `json:"pricing_fairness_score,omitempty"`
	ResponseRate         *float64 `json:"response_rate,omitempty"`
	AverageResponseTime  *int     `json:"average_response_time,omitempty"`

	ConsecutiveHighOffers int        `json:"consecutive_high_offers" gorm:"default:0"`
	FlaggedForReview      bool       `json:"flagged_for_review" gorm:"default:false"`
	LastReviewedAt        *time.Time `json:"last_reviewed_at,omitempty"`

	PeriodStart time.Time  `json:"period_start"`
	PeriodEnd   *time.Time `json:"period_end,omitempty"`
	CreatedAt   time.Time  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt   time.Time  `json:"updated_at" gorm:"autoUpdateTime"`
}

// Participant represents a driver invited to a session
type Participant struct {
	ID        uuid.UUID `json:"id" gorm:"primaryKey;type:uuid"`
	SessionID uuid.UUID `json:"session_id" gorm:"type:uuid;index"`
	DriverID  uuid.UUID `json:"driver_id" gorm:"type:uuid;index"`

	NotifiedAt         *time.Time `json:"notified_at,omitempty"`
	NotificationMethod *string    `json:"notification_method,omitempty" gorm:"type:varchar(20)"`

	ViewedAt     *time.Time `json:"viewed_at,omitempty"`
	RespondedAt  *time.Time `json:"responded_at,omitempty"`
	ResponseType *string    `json:"response_type,omitempty" gorm:"type:varchar(20)"`

	DistanceToPickup    *float64 `json:"distance_to_pickup,omitempty"`
	EstimatedArrivalMin *int     `json:"estimated_arrival_min,omitempty"`

	CreatedAt time.Time `json:"created_at" gorm:"autoCreateTime"`
}

// API Request/Response types

// StartSessionRequest represents a request to start a negotiation session
type StartSessionRequest struct {
	PickupLatitude   float64    `json:"pickup_latitude" binding:"required"`
	PickupLongitude  float64    `json:"pickup_longitude" binding:"required"`
	PickupAddress    string     `json:"pickup_address" binding:"required"`
	DropoffLatitude  float64    `json:"dropoff_latitude" binding:"required"`
	DropoffLongitude float64    `json:"dropoff_longitude" binding:"required"`
	DropoffAddress   string     `json:"dropoff_address" binding:"required"`
	RideTypeID       *uuid.UUID `json:"ride_type_id,omitempty"`
	InitialOffer     *float64   `json:"initial_offer,omitempty"`
}

// SessionResponse represents a session API response
type SessionResponse struct {
	ID                   uuid.UUID        `json:"id"`
	Status               SessionStatus    `json:"status"`
	PickupAddress        string           `json:"pickup_address"`
	DropoffAddress       string           `json:"dropoff_address"`
	CurrencyCode         string           `json:"currency_code"`
	EstimatedFare        float64          `json:"estimated_fare"`
	FairPriceMin         float64          `json:"fair_price_min"`
	FairPriceMax         float64          `json:"fair_price_max"`
	SystemSuggestedPrice float64          `json:"system_suggested_price"`
	RiderInitialOffer    *float64         `json:"rider_initial_offer,omitempty"`
	AcceptedPrice        *float64         `json:"accepted_price,omitempty"`
	ExpiresAt            time.Time        `json:"expires_at"`
	OffersCount          int              `json:"offers_count"`
	Offers               []*OfferResponse `json:"offers,omitempty"`
}

// SubmitOfferRequest represents a driver's offer submission
type SubmitOfferRequest struct {
	OfferedPrice        float64  `json:"offered_price" binding:"required,gt=0"`
	DriverLatitude      *float64 `json:"driver_latitude,omitempty"`
	DriverLongitude     *float64 `json:"driver_longitude,omitempty"`
	EstimatedPickupTime *int     `json:"estimated_pickup_time,omitempty"`
}

// CounterOfferRequest represents a counter-offer
type CounterOfferRequest struct {
	OfferedPrice float64 `json:"offered_price" binding:"required,gt=0"`
}

// OfferResponse represents an offer API response
type OfferResponse struct {
	ID                  uuid.UUID   `json:"id"`
	DriverID            uuid.UUID   `json:"driver_id"`
	OfferedPrice        float64     `json:"offered_price"`
	Status              OfferStatus `json:"status"`
	EstimatedPickupTime *int        `json:"estimated_pickup_time,omitempty"`
	DriverRating        *float64    `json:"driver_rating,omitempty"`
	VehicleModel        *string     `json:"vehicle_model,omitempty"`
	VehicleColor        *string     `json:"vehicle_color,omitempty"`
	IsCounterOffer      bool        `json:"is_counter_offer"`
	CreatedAt           time.Time   `json:"created_at"`
}

// FairPriceCalculation represents the result of fair price calculation
type FairPriceCalculation struct {
	MinPrice          float64  `json:"min_price"`
	MaxPrice          float64  `json:"max_price"`
	SuggestedPrice    float64  `json:"suggested_price"`
	EstimatedFare     float64  `json:"estimated_fare"`
	HistoricalAverage *float64 `json:"historical_average,omitempty"`
	SampleSize        int      `json:"sample_size"`
}

// WebSocket message types

// WSMessageType represents WebSocket message types
type WSMessageType string

const (
	WSTypeSessionUpdate  WSMessageType = "session.update"
	WSTypeOfferNew       WSMessageType = "offer.new"
	WSTypeOfferUpdate    WSMessageType = "offer.update"
	WSTypeOfferAccepted  WSMessageType = "offer.accepted"
	WSTypeSessionExpired WSMessageType = "session.expired"
	WSTypeDriverInvite   WSMessageType = "driver.invite"
)

// WSMessage represents a WebSocket message
type WSMessage struct {
	Type      WSMessageType `json:"type"`
	SessionID uuid.UUID     `json:"session_id"`
	Data      interface{}   `json:"data"`
	Timestamp time.Time     `json:"timestamp"`
}

// Default settings
var DefaultSettings = Settings{
	NegotiationEnabled:         true,
	SessionTimeoutSeconds:      300,
	MaxOffersPerSession:        20,
	MaxCounterOffers:           3,
	OfferTimeoutSeconds:        60,
	MinPriceMultiplier:         0.70,
	MaxPriceMultiplier:         1.50,
	MaxActiveSessionsPerDriver: 5,
}
