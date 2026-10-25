package maps

import (
	"context"

	"github.com/bikky-kc013/medi-ambulance/pkg/config"
)

type MapsProvider interface {
	GetRoute(ctx context.Context, req *RouteRequest) (*RouteResponse, error)
	GetETA(ctx context.Context, req *ETARequest) (*ETAResponse, error)
	GetDistanceMatrix(ctx context.Context, req *DistanceMatrixRequest) (*DistanceMatrixResponse, error)

	GetTrafficFlow(ctx context.Context, req *TrafficFlowRequest) (*TrafficFlowResponse, error)
	GetTrafficIncidents(ctx context.Context, req *TrafficIncidentsRequest) (*TrafficIncidentsResponse, error)

	Geocode(ctx context.Context, req *GeocodingRequest) (*GeocodingResponse, error)
	ReverseGeocode(ctx context.Context, req *GeocodingRequest) (*GeocodingResponse, error)

	SearchPlaces(ctx context.Context, req *PlaceSearchRequest) (*PlaceSearchResponse, error)

	SnapToRoad(ctx context.Context, req *SnapToRoadRequest, timeOutConfig config.TimeoutConfig) (*SnapToRoadResponse, error)
	GetSpeedLimits(ctx context.Context, req *SpeedLimitsRequest, timeOutConfig config.TimeoutConfig) (*SpeedLimitsResponse, error)

	HealthCheck(ctx context.Context) error
	Name() Provider
}

type ProviderConfig struct {
	Provider        Provider `json:"provider"`
	APIKey          string   `json:"api_key"`
	BaseURL         string   `json:"base_url,omitempty"`
	Timeout         int      `json:"timeout_seconds,omitempty"`
	MaxRetries      int      `json:"max_retries,omitempty"`
	RateLimitPerSec int      `json:"rate_limit_per_sec,omitempty"`
}

type Config struct {
	Primary ProviderConfig `json:"primary"`

	Fallbacks []ProviderConfig `json:"fallbacks,omitempty"`

	CacheEnabled    bool   `json:"cache_enabled"`
	CacheTTLSeconds int    `json:"cache_ttl_seconds"`
	CachePrefix     string `json:"cache_prefix"`

	TrafficEnabled        bool `json:"traffic_enabled"`
	TrafficRefreshSeconds int  `json:"traffic_refresh_seconds"`

	EnableRouteAlternatives bool `json:"enable_route_alternatives"`
	EnableSpeedLimits       bool `json:"enable_speed_limits"`
	EnableIncidentAlerts    bool `json:"enable_incident_alerts"`

	MinConfidenceThreshold float64 `json:"min_confidence_threshold"`
	MaxETADeviationPercent float64 `json:"max_eta_deviation_percent"`
}

func DefaultConfig() Config {
	return Config{
		CacheEnabled:            true,
		CacheTTLSeconds:         300,
		CachePrefix:             "maps:",
		TrafficEnabled:          true,
		TrafficRefreshSeconds:   60,
		EnableRouteAlternatives: true,
		EnableSpeedLimits:       false,
		EnableIncidentAlerts:    true,
		MinConfidenceThreshold:  0.7,
		MaxETADeviationPercent:  25,
	}
}
