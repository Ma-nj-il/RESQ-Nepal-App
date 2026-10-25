package demandforecast

import (
	"time"

	"github.com/google/uuid"
)

type PredictionTimeframe string

const (
	Timeframe15Min PredictionTimeframe = "15min"
	Timeframe30Min PredictionTimeframe = "30min"
	Timeframe1Hour PredictionTimeframe = "1hour"
	Timeframe2Hour PredictionTimeframe = "2hour"
	Timeframe4Hour PredictionTimeframe = "4hour"
)

type DemandLevel string

const (
	DemandVeryLow  DemandLevel = "very_low"
	DemandLow      DemandLevel = "low"
	DemandNormal   DemandLevel = "normal"
	DemandHigh     DemandLevel = "high"
	DemandVeryHigh DemandLevel = "very_high"
	DemandExtreme  DemandLevel = "extreme"
)

type HistoricalDemandRecord struct {
	ID                uuid.UUID `json:"id" db:"id"`
	H3Index           string    `json:"h3_index" db:"h3_index"`
	Timestamp         time.Time `json:"timestamp" db:"timestamp"`
	Hour              int       `json:"hour" db:"hour"`
	DayOfWeek         int       `json:"day_of_week" db:"day_of_week"`
	IsHoliday         bool      `json:"is_holiday" db:"is_holiday"`
	RideRequests      int       `json:"ride_requests" db:"ride_requests"`
	CompletedRides    int       `json:"completed_rides" db:"completed_rides"`
	AvailableDrivers  int       `json:"available_drivers" db:"available_drivers"`
	AvgWaitTimeMin    float64   `json:"avg_wait_time_min" db:"avg_wait_time_min"`
	SurgeMultiplier   float64   `json:"surge_multiplier" db:"surge_multiplier"`
	WeatherCondition  string    `json:"weather_condition" db:"weather_condition"`
	Temperature       *float64  `json:"temperature,omitempty" db:"temperature"`
	PrecipitationMM   *float64  `json:"precipitation_mm,omitempty" db:"precipitation_mm"`
	SpecialEventType  *string   `json:"special_event_type,omitempty" db:"special_event_type"`
	SpecialEventScale *int      `json:"special_event_scale,omitempty" db:"special_event_scale"`
	CreatedAt         time.Time `json:"created_at" db:"created_at"`
}

type DemandPrediction struct {
	ID                   uuid.UUID            `json:"id" db:"id"`
	H3Index              string               `json:"h3_index" db:"h3_index"`
	PredictionTime       time.Time            `json:"prediction_time" db:"prediction_time"`
	GeneratedAt          time.Time            `json:"generated_at" db:"generated_at"`
	Timeframe            PredictionTimeframe  `json:"timeframe" db:"timeframe"`
	PredictedRides       float64              `json:"predicted_rides" db:"predicted_rides"`
	DemandLevel          DemandLevel          `json:"demand_level" db:"demand_level"`
	Confidence           float64              `json:"confidence" db:"confidence"`
	RecommendedDrivers   int                  `json:"recommended_drivers" db:"recommended_drivers"`
	ExpectedSurge        float64              `json:"expected_surge" db:"expected_surge"`
	HotspotScore         float64              `json:"hotspot_score" db:"hotspot_score"`
	RepositionPriority   int                  `json:"reposition_priority" db:"reposition_priority"`
	FeatureContributions FeatureContributions `json:"feature_contributions" db:"-"`
}

type FeatureContributions struct {
	HistoricalPattern float64 `json:"historical_pattern"`
	RecentTrend       float64 `json:"recent_trend"`
	TimeOfDay         float64 `json:"time_of_day"`
	DayOfWeek         float64 `json:"day_of_week"`
	Weather           float64 `json:"weather"`
	SpecialEvents     float64 `json:"special_events"`
	SeasonalTrend     float64 `json:"seasonal_trend"`
}

type DriverRepositionRecommendation struct {
	DriverID           uuid.UUID `json:"driver_id"`
	CurrentH3Index     string    `json:"current_h3_index"`
	TargetH3Index      string    `json:"target_h3_index"`
	TargetLatitude     float64   `json:"target_latitude"`
	TargetLongitude    float64   `json:"target_longitude"`
	DistanceKm         float64   `json:"distance_km"`
	Priority           int       `json:"priority"`
	ExpectedRides      float64   `json:"expected_rides"`
	ExpectedEarnings   float64   `json:"expected_earnings"`
	ExpectedSurge      float64   `json:"expected_surge"`
	RecommendedArrival time.Time `json:"recommended_arrival"`
	Reason             string    `json:"reason"`
}

type HotspotZone struct {
	H3Index         string      `json:"h3_index"`
	CenterLatitude  float64     `json:"center_latitude"`
	CenterLongitude float64     `json:"center_longitude"`
	DemandLevel     DemandLevel `json:"demand_level"`
	PredictedRides  float64     `json:"predicted_rides"`
	CurrentDrivers  int         `json:"current_drivers"`
	NeededDrivers   int         `json:"needed_drivers"`
	Gap             int         `json:"gap"`
	ExpectedSurge   float64     `json:"expected_surge"`
	HotspotScore    float64     `json:"hotspot_score"`
	ValidUntil      time.Time   `json:"valid_until"`
}

type DemandHeatmap struct {
	GeneratedAt time.Time           `json:"generated_at"`
	Timeframe   PredictionTimeframe `json:"timeframe"`
	Zones       []HotspotZone       `json:"zones"`
	BoundingBox BoundingBox         `json:"bounding_box"`
}

type BoundingBox struct {
	MinLatitude  float64 `json:"min_latitude"`
	MaxLatitude  float64 `json:"max_latitude"`
	MinLongitude float64 `json:"min_longitude"`
	MaxLongitude float64 `json:"max_longitude"`
}

type ModelFeatures struct {
	H3Index           string    `json:"h3_index"`
	TargetTime        time.Time `json:"target_time"`
	Hour              int       `json:"hour"`
	DayOfWeek         int       `json:"day_of_week"`
	IsWeekend         bool      `json:"is_weekend"`
	IsHoliday         bool      `json:"is_holiday"`
	WeekOfYear        int       `json:"week_of_year"`
	MonthOfYear       int       `json:"month_of_year"`
	HistAvgRides      float64   `json:"hist_avg_rides"`
	HistStdRides      float64   `json:"hist_std_rides"`
	RecentRides15min  int       `json:"recent_rides_15min"`
	RecentRides1hr    int       `json:"recent_rides_1hr"`
	RecentTrend       float64   `json:"recent_trend"`
	CurrentDrivers    int       `json:"current_drivers"`
	NeighborDemandAvg float64   `json:"neighbor_demand_avg"`
	WeatherCode       int       `json:"weather_code"`
	Temperature       float64   `json:"temperature"`
	PrecipitationProb float64   `json:"precipitation_prob"`
	EventNearby       bool      `json:"event_nearby"`
	EventScale        int       `json:"event_scale"`
	ZoneType          int       `json:"zone_type"`
	IsAirportZone     bool      `json:"is_airport_zone"`
	IsTransitHub      bool      `json:"is_transit_hub"`
	LaggingDemand1hr  float64   `json:"lagging_demand_1hr"`
	LaggingDemand2hr  float64   `json:"lagging_demand_2hr"`
}

type ModelPrediction struct {
	PredictedRides float64 `json:"predicted_rides"`
	LowerBound     float64 `json:"lower_bound"`
	UpperBound     float64 `json:"upper_bound"`
	Confidence     float64 `json:"confidence"`
}

type SpecialEvent struct {
	ID                uuid.UUID `json:"id" db:"id"`
	Name              string    `json:"name" db:"name"`
	EventType         string    `json:"event_type" db:"event_type"`
	Latitude          float64   `json:"latitude" db:"latitude"`
	Longitude         float64   `json:"longitude" db:"longitude"`
	H3Index           string    `json:"h3_index" db:"h3_index"`
	StartTime         time.Time `json:"start_time" db:"start_time"`
	EndTime           time.Time `json:"end_time" db:"end_time"`
	ExpectedAttendees int       `json:"expected_attendees" db:"expected_attendees"`
	ImpactRadius      float64   `json:"impact_radius" db:"impact_radius"`
	DemandMultiplier  float64   `json:"demand_multiplier" db:"demand_multiplier"`
	IsRecurring       bool      `json:"is_recurring" db:"is_recurring"`
	CreatedAt         time.Time `json:"created_at" db:"created_at"`
	UpdatedAt         time.Time `json:"updated_at" db:"updated_at"`
}

type WeatherData struct {
	H3Index           string    `json:"h3_index"`
	Timestamp         time.Time `json:"timestamp"`
	Condition         string    `json:"condition"`
	ConditionCode     int       `json:"condition_code"`
	Temperature       float64   `json:"temperature"`
	FeelsLike         float64   `json:"feels_like"`
	Humidity          float64   `json:"humidity"`
	WindSpeed         float64   `json:"wind_speed"`
	PrecipitationMM   float64   `json:"precipitation_mm"`
	PrecipitationProb float64   `json:"precipitation_prob"`
	Visibility        float64   `json:"visibility"`
}

type GetPredictionRequest struct {
	Latitude  float64             `json:"latitude" binding:"required"`
	Longitude float64             `json:"longitude" binding:"required"`
	Timeframe PredictionTimeframe `json:"timeframe" binding:"required"`
}

type GetPredictionResponse struct {
	Location    LocationInfo       `json:"location"`
	Prediction  DemandPrediction   `json:"prediction"`
	Neighbors   []DemandPrediction `json:"neighbors"`
	LastUpdated time.Time          `json:"last_updated"`
}

type LocationInfo struct {
	H3Index   string  `json:"h3_index"`
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	ZoneName  *string `json:"zone_name,omitempty"`
	ZoneType  *string `json:"zone_type,omitempty"`
}

type GetHeatmapRequest struct {
	MinLatitude    float64             `json:"min_latitude" binding:"required"`
	MaxLatitude    float64             `json:"max_latitude" binding:"required"`
	MinLongitude   float64             `json:"min_longitude" binding:"required"`
	MaxLongitude   float64             `json:"max_longitude" binding:"required"`
	Timeframe      PredictionTimeframe `json:"timeframe" binding:"required"`
	MinDemandLevel *DemandLevel        `json:"min_demand_level,omitempty"`
}

type GetRepositionRecommendationsRequest struct {
	DriverID      uuid.UUID `json:"-"`
	Latitude      float64   `json:"latitude" binding:"required"`
	Longitude     float64   `json:"longitude" binding:"required"`
	MaxDistanceKm float64   `json:"max_distance_km"`
	Limit         int       `json:"limit"`
}

type GetRepositionRecommendationsResponse struct {
	CurrentZone       HotspotZone                      `json:"current_zone"`
	Recommendations   []DriverRepositionRecommendation `json:"recommendations"`
	EstimatedEarnings float64                          `json:"estimated_earnings"`
}

type CreateEventRequest struct {
	Name              string  `json:"name" binding:"required"`
	EventType         string  `json:"event_type" binding:"required"`
	Latitude          float64 `json:"latitude" binding:"required"`
	Longitude         float64 `json:"longitude" binding:"required"`
	StartTime         string  `json:"start_time" binding:"required"`
	EndTime           string  `json:"end_time" binding:"required"`
	ExpectedAttendees int     `json:"expected_attendees" binding:"required"`
	ImpactRadius      float64 `json:"impact_radius"`
	IsRecurring       bool    `json:"is_recurring"`
}

type ForecastAccuracyMetrics struct {
	Timeframe        PredictionTimeframe `json:"timeframe"`
	MAE              float64             `json:"mae"`
	RMSE             float64             `json:"rmse"`
	MAPE             float64             `json:"mape"`
	R2Score          float64             `json:"r2_score"`
	DirectionAcc     float64             `json:"direction_acc"`
	SamplesEvaluated int                 `json:"samples_evaluated"`
	EvaluationPeriod string              `json:"evaluation_period"`
	UpdatedAt        time.Time           `json:"updated_at"`
}

type ModelConfig struct {
	ModelVersion      string             `json:"model_version"`
	Features          []string           `json:"features"`
	H3Resolution      int                `json:"h3_resolution"`
	TrainingDataDays  int                `json:"training_data_days"`
	UpdateFrequency   string             `json:"update_frequency"`
	WeatherAPIEnabled bool               `json:"weather_api_enabled"`
	EventsEnabled     bool               `json:"events_enabled"`
	Weights           map[string]float64 `json:"weights"`
}
