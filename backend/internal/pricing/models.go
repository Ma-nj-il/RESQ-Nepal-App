package pricing

import (
	"database/sql/driver"
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

type PricingConfig struct {
	ID         uuid.UUID  `json:"id" gorm:"primaryKey;type:uuid"`
	VersionID  uuid.UUID  `json:"version_id" gorm:"type:uuid;index"`
	CountryID  *uuid.UUID `json:"country_id,omitempty" gorm:"type:uuid;index"`
	RegionID   *uuid.UUID `json:"region_id,omitempty" gorm:"type:uuid;index"`
	CityID     *uuid.UUID `json:"city_id,omitempty" gorm:"type:uuid;index"`
	ZoneID     *uuid.UUID `json:"zone_id,omitempty" gorm:"type:uuid;index"`
	RideTypeID *uuid.UUID `json:"ride_type_id,omitempty" gorm:"type:uuid;index"`

	BaseFare      *float64 `json:"base_fare,omitempty"`
	PerKmRate     *float64 `json:"per_km_rate,omitempty"`
	PerMinuteRate *float64 `json:"per_minute_rate,omitempty"`
	MinimumFare   *float64 `json:"minimum_fare,omitempty"`
	BookingFee    *float64 `json:"booking_fee,omitempty"`

	PlatformCommissionPct *float64 `json:"platform_commission_pct,omitempty"`
	DriverIncentivePct    *float64 `json:"driver_incentive_pct,omitempty"`

	SurgeMinMultiplier *float64 `json:"surge_min_multiplier,omitempty"`
	SurgeMaxMultiplier *float64 `json:"surge_max_multiplier,omitempty"`

	TaxRatePct   *float64 `json:"tax_rate_pct,omitempty"`
	TaxInclusive *bool    `json:"tax_inclusive,omitempty"`

	CancellationFees CancellationFees `json:"cancellation_fees,omitempty" gorm:"type:jsonb"`

	IsActive  bool      `json:"is_active" gorm:"default:true;index"`
	CreatedAt time.Time `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt time.Time `json:"updated_at" gorm:"autoUpdateTime"`
}

type CancellationFees []CancellationFee

type CancellationFee struct {
	AfterMinutes int     `json:"after_minutes"`
	Fee          float64 `json:"fee"`
	FeeType      string  `json:"fee_type"`
}

type ResolvedPricing struct {
	VersionID  uuid.UUID  `json:"version_id"`
	CountryID  *uuid.UUID `json:"country_id,omitempty"`
	RegionID   *uuid.UUID `json:"region_id,omitempty"`
	CityID     *uuid.UUID `json:"city_id,omitempty"`
	ZoneID     *uuid.UUID `json:"zone_id,omitempty"`
	RideTypeID *uuid.UUID `json:"ride_type_id,omitempty"`

	BaseFare              float64           `json:"base_fare"`
	PerKmRate             float64           `json:"per_km_rate"`
	PerMinuteRate         float64           `json:"per_minute_rate"`
	MinimumFare           float64           `json:"minimum_fare"`
	BookingFee            float64           `json:"booking_fee"`
	PlatformCommissionPct float64           `json:"platform_commission_pct"`
	DriverIncentivePct    float64           `json:"driver_incentive_pct"`
	SurgeMinMultiplier    float64           `json:"surge_min_multiplier"`
	SurgeMaxMultiplier    float64           `json:"surge_max_multiplier"`
	TaxRatePct            float64           `json:"tax_rate_pct"`
	TaxInclusive          bool              `json:"tax_inclusive"`
	CancellationFees      []CancellationFee `json:"cancellation_fees"`

	InheritanceChain []string `json:"inheritance_chain,omitempty"`
}

type ZoneFee struct {
	ID             uuid.UUID    `json:"id" gorm:"primaryKey;type:uuid"`
	ZoneID         uuid.UUID    `json:"zone_id" gorm:"type:uuid;index"`
	VersionID      uuid.UUID    `json:"version_id" gorm:"type:uuid;index"`
	FeeType        string       `json:"fee_type" gorm:"type:varchar(50)"`
	RideTypeID     *uuid.UUID   `json:"ride_type_id,omitempty" gorm:"type:uuid;index"`
	Amount         float64      `json:"amount"`
	IsPercentage   bool         `json:"is_percentage" gorm:"default:false"`
	AppliesPickup  bool         `json:"applies_pickup" gorm:"default:true"`
	AppliesDropoff bool         `json:"applies_dropoff" gorm:"default:true"`
	Schedule       *FeeSchedule `json:"schedule,omitempty" gorm:"type:jsonb"`
	IsActive       bool         `json:"is_active" gorm:"default:true;index"`
	CreatedAt      time.Time    `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt      time.Time    `json:"updated_at" gorm:"autoUpdateTime"`
}

type FeeSchedule struct {
	Days      []int  `json:"days"`
	StartTime string `json:"start_time"`
	EndTime   string `json:"end_time"`
}

type TimeMultiplier struct {
	ID         uuid.UUID  `json:"id" gorm:"primaryKey;type:uuid"`
	VersionID  uuid.UUID  `json:"version_id" gorm:"type:uuid;index"`
	CountryID  *uuid.UUID `json:"country_id,omitempty" gorm:"type:uuid;index"`
	RegionID   *uuid.UUID `json:"region_id,omitempty" gorm:"type:uuid;index"`
	CityID     *uuid.UUID `json:"city_id,omitempty" gorm:"type:uuid;index"`
	Name       string     `json:"name" gorm:"type:varchar(100)"`
	DaysOfWeek []int      `json:"days_of_week" gorm:"type:integer[]"`
	StartTime  string     `json:"start_time" gorm:"type:time"`
	EndTime    string     `json:"end_time" gorm:"type:time"`
	Multiplier float64    `json:"multiplier"`
	Priority   int        `json:"priority" gorm:"default:0"`
	IsActive   bool       `json:"is_active" gorm:"default:true;index"`
	CreatedAt  time.Time  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt  time.Time  `json:"updated_at" gorm:"autoUpdateTime"`
}

type WeatherMultiplier struct {
	ID               uuid.UUID  `json:"id" gorm:"primaryKey;type:uuid"`
	VersionID        uuid.UUID  `json:"version_id" gorm:"type:uuid;index"`
	CountryID        *uuid.UUID `json:"country_id,omitempty" gorm:"type:uuid;index"`
	RegionID         *uuid.UUID `json:"region_id,omitempty" gorm:"type:uuid;index"`
	CityID           *uuid.UUID `json:"city_id,omitempty" gorm:"type:uuid;index"`
	WeatherCondition string     `json:"weather_condition" gorm:"type:varchar(50);index"`
	Multiplier       float64    `json:"multiplier"`
	IsActive         bool       `json:"is_active" gorm:"default:true;index"`
	CreatedAt        time.Time  `json:"created_at" gorm:"autoCreateTime"`
}

type EventMultiplier struct {
	ID                     uuid.UUID  `json:"id" gorm:"primaryKey;type:uuid"`
	VersionID              uuid.UUID  `json:"version_id" gorm:"type:uuid;index"`
	ZoneID                 *uuid.UUID `json:"zone_id,omitempty" gorm:"type:uuid;index"`
	CityID                 *uuid.UUID `json:"city_id,omitempty" gorm:"type:uuid;index"`
	EventName              string     `json:"event_name" gorm:"type:varchar(200)"`
	EventType              string     `json:"event_type" gorm:"type:varchar(50)"`
	StartsAt               time.Time  `json:"starts_at" gorm:"index"`
	EndsAt                 time.Time  `json:"ends_at" gorm:"index"`
	PreEventMinutes        int        `json:"pre_event_minutes" gorm:"default:0"`
	PostEventMinutes       int        `json:"post_event_minutes" gorm:"default:0"`
	Multiplier             float64    `json:"multiplier"`
	ExpectedDemandIncrease *int       `json:"expected_demand_increase,omitempty"`
	IsActive               bool       `json:"is_active" gorm:"default:true;index"`
	CreatedAt              time.Time  `json:"created_at" gorm:"autoCreateTime"`
}

type SurgeThreshold struct {
	ID                   uuid.UUID  `json:"id" gorm:"primaryKey;type:uuid"`
	VersionID            uuid.UUID  `json:"version_id" gorm:"type:uuid;index"`
	CountryID            *uuid.UUID `json:"country_id,omitempty" gorm:"type:uuid;index"`
	RegionID             *uuid.UUID `json:"region_id,omitempty" gorm:"type:uuid;index"`
	CityID               *uuid.UUID `json:"city_id,omitempty" gorm:"type:uuid;index"`
	DemandSupplyRatioMin float64    `json:"demand_supply_ratio_min"`
	DemandSupplyRatioMax *float64   `json:"demand_supply_ratio_max,omitempty"`
	Multiplier           float64    `json:"multiplier"`
	IsActive             bool       `json:"is_active" gorm:"default:true;index"`
	CreatedAt            time.Time  `json:"created_at" gorm:"autoCreateTime"`
}

type FareCalculation struct {
	DistanceKm  float64 `json:"distance_km"`
	DurationMin int     `json:"duration_min"`
	Currency    string  `json:"currency"`

	BaseFare       float64 `json:"base_fare"`
	DistanceCharge float64 `json:"distance_charge"`
	TimeCharge     float64 `json:"time_charge"`
	BookingFee     float64 `json:"booking_fee"`

	ZoneFeesTotal     float64            `json:"zone_fees_total"`
	ZoneFeesBreakdown []ZoneFeeBreakdown `json:"zone_fees_breakdown,omitempty"`

	TimeMultiplier    float64 `json:"time_multiplier"`
	WeatherMultiplier float64 `json:"weather_multiplier"`
	EventMultiplier   float64 `json:"event_multiplier"`
	SurgeMultiplier   float64 `json:"surge_multiplier"`
	TotalMultiplier   float64 `json:"total_multiplier"`

	Subtotal   float64 `json:"subtotal"`
	TaxRatePct float64 `json:"tax_rate_pct"`
	TaxAmount  float64 `json:"tax_amount"`
	TotalFare  float64 `json:"total_fare"`

	PlatformCommissionPct float64 `json:"platform_commission_pct"`
	PlatformCommission    float64 `json:"platform_commission"`
	DriverEarnings        float64 `json:"driver_earnings"`

	// Metadata
	PricingVersionID uuid.UUID `json:"pricing_version_id"`
	WasNegotiated    bool      `json:"was_negotiated"`
	NegotiatedFare   *float64  `json:"negotiated_fare,omitempty"`
}

type ZoneFeeBreakdown struct {
	ZoneID   uuid.UUID `json:"zone_id"`
	ZoneName string    `json:"zone_name"`
	FeeType  string    `json:"fee_type"`
	Amount   float64   `json:"amount"`
}

type EstimateRequest struct {
	PickupLatitude   float64    `json:"pickup_latitude" binding:"required"`
	PickupLongitude  float64    `json:"pickup_longitude" binding:"required"`
	DropoffLatitude  float64    `json:"dropoff_latitude" binding:"required"`
	DropoffLongitude float64    `json:"dropoff_longitude" binding:"required"`
	RideTypeID       *uuid.UUID `json:"ride_type_id,omitempty"`
}

type EstimateResponse struct {
	Currency         string           `json:"currency"`
	EstimatedFare    float64          `json:"estimated_fare"`
	MinimumFare      float64          `json:"minimum_fare"`
	SurgeMultiplier  float64          `json:"surge_multiplier"`
	DistanceKm       float64          `json:"distance_km"`
	EstimatedMinutes int              `json:"estimated_minutes"`
	FareBreakdown    *FareCalculation `json:"fare_breakdown,omitempty"`
	FormattedFare    string           `json:"formatted_fare"`
}

type BulkEstimateRequest struct {
	PickupLatitude   float64 `json:"pickup_latitude" binding:"required"`
	PickupLongitude  float64 `json:"pickup_longitude" binding:"required"`
	DropoffLatitude  float64 `json:"dropoff_latitude" binding:"required"`
	DropoffLongitude float64 `json:"dropoff_longitude" binding:"required"`
}

type RideTypeInfo struct {
	ID          uuid.UUID `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Capacity    int       `json:"capacity"`
	IconURL     *string   `json:"icon_url,omitempty"`
}

type RideTypeEstimate struct {
	RideTypeID        uuid.UUID        `json:"ride_type_id"`
	RideTypeName      string           `json:"ride_type_name"`
	Description       string           `json:"description"`
	Capacity          int              `json:"capacity"`
	IconURL           *string          `json:"icon_url,omitempty"`
	Currency          string           `json:"currency"`
	EstimatedFare     float64          `json:"estimated_fare"`
	MinimumFare       float64          `json:"minimum_fare"`
	SurgeMultiplier   float64          `json:"surge_multiplier"`
	FareBreakdown     *FareCalculation `json:"fare_breakdown,omitempty"`
	FormattedFare     string           `json:"formatted_fare"`
	ETAMinutes        *int             `json:"eta_minutes,omitempty"`
	AvailableVehicles *int             `json:"available_vehicles,omitempty"`
}

type BulkEstimateResponse struct {
	PickupAddress    string             `json:"pickup_address,omitempty"`
	DropoffAddress   string             `json:"dropoff_address,omitempty"`
	DistanceKm       float64            `json:"distance_km"`
	EstimatedMinutes int                `json:"estimated_minutes"`
	RideOptions      []RideTypeEstimate `json:"ride_options"`
}

const (
	WeatherClear     = "clear"
	WeatherCloudy    = "cloudy"
	WeatherRain      = "rain"
	WeatherHeavyRain = "heavy_rain"
	WeatherSnow      = "snow"
	WeatherStorm     = "storm"
	WeatherHeat      = "extreme_heat"
	WeatherFog       = "fog"
)

const (
	EventTypeSports     = "sports"
	EventTypeConcert    = "concert"
	EventTypeConference = "conference"
	EventTypeHoliday    = "holiday"
	EventTypeFestival   = "festival"
	EventTypeOther      = "other"
)

type PricingConfigVersion struct {
	ID               uuid.UUID  `json:"id" gorm:"primaryKey;type:uuid"`
	VersionNumber    int        `json:"version_number" gorm:"index"`
	Name             string     `json:"name" gorm:"type:varchar(200)"`
	Description      *string    `json:"description,omitempty" gorm:"type:text"`
	Status           string     `json:"status" gorm:"type:varchar(50);index"`
	ABTestPercentage *int       `json:"ab_test_percentage,omitempty"`
	EffectiveFrom    *time.Time `json:"effective_from,omitempty" gorm:"index"`
	EffectiveUntil   *time.Time `json:"effective_until,omitempty" gorm:"index"`
	CreatedBy        *uuid.UUID `json:"created_by,omitempty" gorm:"type:uuid"`
	ApprovedBy       *uuid.UUID `json:"approved_by,omitempty" gorm:"type:uuid"`
	ApprovedAt       *time.Time `json:"approved_at,omitempty"`
	CreatedAt        time.Time  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt        time.Time  `json:"updated_at" gorm:"autoUpdateTime"`
}

type PricingAuditLog struct {
	ID         uuid.UUID              `json:"id" gorm:"primaryKey;type:uuid"`
	AdminID    uuid.UUID              `json:"admin_id" gorm:"type:uuid;index"`
	Action     string                 `json:"action" gorm:"type:varchar(100)"`
	EntityType string                 `json:"entity_type" gorm:"type:varchar(100)"`
	EntityID   uuid.UUID              `json:"entity_id" gorm:"type:uuid;index"`
	OldValues  map[string]interface{} `json:"old_values,omitempty" gorm:"type:jsonb"`
	NewValues  map[string]interface{} `json:"new_values,omitempty" gorm:"type:jsonb"`
	Reason     *string                `json:"reason,omitempty" gorm:"type:text"`
	CreatedAt  time.Time              `json:"created_at" gorm:"autoCreateTime"`
}

const (
	VersionStatusDraft    = "draft"
	VersionStatusActive   = "active"
	VersionStatusArchived = "archived"
	VersionStatusABTest   = "ab_test"
)

type CreateVersionRequest struct {
	Name           string     `json:"name" binding:"required"`
	Description    *string    `json:"description,omitempty"`
	EffectiveFrom  *time.Time `json:"effective_from,omitempty"`
	EffectiveUntil *time.Time `json:"effective_until,omitempty"`
}

type UpdateVersionRequest struct {
	Name           *string    `json:"name,omitempty"`
	Description    *string    `json:"description,omitempty"`
	EffectiveFrom  *time.Time `json:"effective_from,omitempty"`
	EffectiveUntil *time.Time `json:"effective_until,omitempty"`
}

type CloneVersionRequest struct {
	Name string `json:"name" binding:"required"`
}

type CreateConfigRequest struct {
	CountryID             *uuid.UUID        `json:"country_id,omitempty"`
	RegionID              *uuid.UUID        `json:"region_id,omitempty"`
	CityID                *uuid.UUID        `json:"city_id,omitempty"`
	ZoneID                *uuid.UUID        `json:"zone_id,omitempty"`
	RideTypeID            *uuid.UUID        `json:"ride_type_id,omitempty"`
	BaseFare              *float64          `json:"base_fare,omitempty"`
	PerKmRate             *float64          `json:"per_km_rate,omitempty"`
	PerMinuteRate         *float64          `json:"per_minute_rate,omitempty"`
	MinimumFare           *float64          `json:"minimum_fare,omitempty"`
	BookingFee            *float64          `json:"booking_fee,omitempty"`
	PlatformCommissionPct *float64          `json:"platform_commission_pct,omitempty"`
	DriverIncentivePct    *float64          `json:"driver_incentive_pct,omitempty"`
	SurgeMinMultiplier    *float64          `json:"surge_min_multiplier,omitempty"`
	SurgeMaxMultiplier    *float64          `json:"surge_max_multiplier,omitempty"`
	TaxRatePct            *float64          `json:"tax_rate_pct,omitempty"`
	TaxInclusive          *bool             `json:"tax_inclusive,omitempty"`
	CancellationFees      []CancellationFee `json:"cancellation_fees,omitempty"`
	IsActive              bool              `json:"is_active"`
}

type UpdateConfigRequest = CreateConfigRequest

type CreateTimeMultiplierRequest struct {
	CountryID  *uuid.UUID `json:"country_id,omitempty"`
	RegionID   *uuid.UUID `json:"region_id,omitempty"`
	CityID     *uuid.UUID `json:"city_id,omitempty"`
	Name       string     `json:"name" binding:"required"`
	DaysOfWeek []int      `json:"days_of_week" binding:"required"`
	StartTime  string     `json:"start_time" binding:"required"`
	EndTime    string     `json:"end_time" binding:"required"`
	Multiplier float64    `json:"multiplier" binding:"required,gt=0"`
	Priority   int        `json:"priority"`
	IsActive   bool       `json:"is_active"`
}

type UpdateTimeMultiplierRequest = CreateTimeMultiplierRequest

type CreateWeatherMultiplierRequest struct {
	CountryID        *uuid.UUID `json:"country_id,omitempty"`
	RegionID         *uuid.UUID `json:"region_id,omitempty"`
	CityID           *uuid.UUID `json:"city_id,omitempty"`
	WeatherCondition string     `json:"weather_condition" binding:"required"`
	Multiplier       float64    `json:"multiplier" binding:"required,gt=0"`
	IsActive         bool       `json:"is_active"`
}

type UpdateWeatherMultiplierRequest = CreateWeatherMultiplierRequest

type CreateEventMultiplierRequest struct {
	ZoneID                 *uuid.UUID `json:"zone_id,omitempty"`
	CityID                 *uuid.UUID `json:"city_id,omitempty"`
	EventName              string     `json:"event_name" binding:"required"`
	EventType              string     `json:"event_type" binding:"required"`
	StartsAt               time.Time  `json:"starts_at" binding:"required"`
	EndsAt                 time.Time  `json:"ends_at" binding:"required"`
	PreEventMinutes        int        `json:"pre_event_minutes"`
	PostEventMinutes       int        `json:"post_event_minutes"`
	Multiplier             float64    `json:"multiplier" binding:"required,gt=0"`
	ExpectedDemandIncrease *int       `json:"expected_demand_increase,omitempty"`
	IsActive               bool       `json:"is_active"`
}

type UpdateEventMultiplierRequest = CreateEventMultiplierRequest

type CreateZoneFeeRequest struct {
	ZoneID         uuid.UUID    `json:"zone_id" binding:"required"`
	FeeType        string       `json:"fee_type" binding:"required"`
	RideTypeID     *uuid.UUID   `json:"ride_type_id,omitempty"`
	Amount         float64      `json:"amount" binding:"required"`
	IsPercentage   bool         `json:"is_percentage"`
	AppliesPickup  bool         `json:"applies_pickup"`
	AppliesDropoff bool         `json:"applies_dropoff"`
	Schedule       *FeeSchedule `json:"schedule,omitempty"`
	IsActive       bool         `json:"is_active"`
}

type UpdateZoneFeeRequest = CreateZoneFeeRequest

type CreateSurgeThresholdRequest struct {
	CountryID            *uuid.UUID `json:"country_id,omitempty"`
	RegionID             *uuid.UUID `json:"region_id,omitempty"`
	CityID               *uuid.UUID `json:"city_id,omitempty"`
	DemandSupplyRatioMin float64    `json:"demand_supply_ratio_min" binding:"required"`
	DemandSupplyRatioMax *float64   `json:"demand_supply_ratio_max,omitempty"`
	Multiplier           float64    `json:"multiplier" binding:"required,gt=0"`
	IsActive             bool       `json:"is_active"`
}

type UpdateSurgeThresholdRequest = CreateSurgeThresholdRequest

var DefaultPricing = ResolvedPricing{
	BaseFare:              3.00,
	PerKmRate:             1.50,
	PerMinuteRate:         0.25,
	MinimumFare:           5.00,
	BookingFee:            1.00,
	PlatformCommissionPct: 20.00,
	DriverIncentivePct:    0.00,
	SurgeMinMultiplier:    1.00,
	SurgeMaxMultiplier:    5.00,
	TaxRatePct:            0.00,
	TaxInclusive:          false,
	CancellationFees: []CancellationFee{
		{AfterMinutes: 0, Fee: 0, FeeType: "fixed"},
		{AfterMinutes: 2, Fee: 5, FeeType: "fixed"},
		{AfterMinutes: 5, Fee: 10, FeeType: "fixed"},
	},
}

func (cf *CancellationFees) Scan(value interface{}) error {
	return json.Unmarshal(value.([]byte), cf)
}

func (cf CancellationFees) Value() (driver.Value, error) {
	return json.Marshal(cf)
}

func (fs *FeeSchedule) Scan(value interface{}) error {
	if value == nil {
		return nil
	}
	return json.Unmarshal(value.([]byte), fs)
}

func (fs *FeeSchedule) Value() (driver.Value, error) {
	if fs == nil {
		return nil, nil
	}
	return json.Marshal(fs)
}
