package pricing

import (
	"context"
	"time"

	"github.com/google/uuid"
)

type RepositoryInterface interface {
	GetActiveVersionID(ctx context.Context) (uuid.UUID, error)
	GetPricingConfigsForResolution(ctx context.Context, versionID uuid.UUID, countryID, regionID, cityID, zoneID, rideTypeID *uuid.UUID) ([]*PricingConfig, error)
	GetZoneFees(ctx context.Context, versionID uuid.UUID, pickupZoneID, dropoffZoneID *uuid.UUID, rideTypeID *uuid.UUID) ([]*ZoneFee, error)
	GetTimeMultipliers(ctx context.Context, versionID uuid.UUID, countryID, regionID, cityID *uuid.UUID, t time.Time) ([]*TimeMultiplier, error)
	GetWeatherMultiplier(ctx context.Context, versionID uuid.UUID, countryID, regionID, cityID *uuid.UUID, condition string) (*WeatherMultiplier, error)
	GetActiveEventMultipliers(ctx context.Context, versionID uuid.UUID, cityID, zoneID *uuid.UUID, t time.Time) ([]*EventMultiplier, error)
	GetSurgeThresholds(ctx context.Context, versionID uuid.UUID, countryID, regionID, cityID *uuid.UUID) ([]*SurgeThreshold, error)
	GetZoneName(ctx context.Context, zoneID uuid.UUID) (string, error)

	CreateVersion(ctx context.Context, version *PricingConfigVersion) error
	GetVersionByID(ctx context.Context, id uuid.UUID) (*PricingConfigVersion, error)
	ListVersions(ctx context.Context, limit, offset int, status string) ([]*PricingConfigVersion, int64, error)
	UpdateVersion(ctx context.Context, version *PricingConfigVersion) error
	ActivateVersion(ctx context.Context, id uuid.UUID, adminID uuid.UUID) error
	ArchiveVersion(ctx context.Context, id uuid.UUID) error
	CloneVersion(ctx context.Context, sourceID uuid.UUID, name string, adminID uuid.UUID) (*PricingConfigVersion, error)

	CreateConfig(ctx context.Context, config *PricingConfig) error
	GetConfigByID(ctx context.Context, id uuid.UUID) (*PricingConfig, error)
	ListConfigs(ctx context.Context, versionID uuid.UUID, limit, offset int) ([]*PricingConfig, int64, error)
	UpdateConfig(ctx context.Context, config *PricingConfig) error
	DeleteConfig(ctx context.Context, id uuid.UUID) error

	CreateTimeMultiplier(ctx context.Context, m *TimeMultiplier) error
	GetTimeMultiplierByID(ctx context.Context, id uuid.UUID) (*TimeMultiplier, error)
	ListTimeMultipliersByVersion(ctx context.Context, versionID uuid.UUID, limit, offset int) ([]*TimeMultiplier, int64, error)
	UpdateTimeMultiplier(ctx context.Context, m *TimeMultiplier) error
	DeleteTimeMultiplier(ctx context.Context, id uuid.UUID) error

	CreateWeatherMultiplier(ctx context.Context, m *WeatherMultiplier) error
	GetWeatherMultiplierByID(ctx context.Context, id uuid.UUID) (*WeatherMultiplier, error)
	ListWeatherMultipliersByVersion(ctx context.Context, versionID uuid.UUID, limit, offset int) ([]*WeatherMultiplier, int64, error)
	UpdateWeatherMultiplier(ctx context.Context, m *WeatherMultiplier) error
	DeleteWeatherMultiplier(ctx context.Context, id uuid.UUID) error

	CreateEventMultiplier(ctx context.Context, m *EventMultiplier) error
	GetEventMultiplierByID(ctx context.Context, id uuid.UUID) (*EventMultiplier, error)
	ListEventMultipliersByVersion(ctx context.Context, versionID uuid.UUID, limit, offset int) ([]*EventMultiplier, int64, error)
	UpdateEventMultiplier(ctx context.Context, m *EventMultiplier) error
	DeleteEventMultiplier(ctx context.Context, id uuid.UUID) error

	CreateZoneFee(ctx context.Context, fee *ZoneFee) error
	GetZoneFeeByID(ctx context.Context, id uuid.UUID) (*ZoneFee, error)
	ListZoneFeesByVersion(ctx context.Context, versionID uuid.UUID, zoneID *uuid.UUID, limit, offset int) ([]*ZoneFee, int64, error)
	UpdateZoneFee(ctx context.Context, fee *ZoneFee) error
	DeleteZoneFee(ctx context.Context, id uuid.UUID) error

	CreateSurgeThreshold(ctx context.Context, t *SurgeThreshold) error
	GetSurgeThresholdByID(ctx context.Context, id uuid.UUID) (*SurgeThreshold, error)
	ListSurgeThresholdsByVersion(ctx context.Context, versionID uuid.UUID, limit, offset int) ([]*SurgeThreshold, int64, error)
	UpdateSurgeThreshold(ctx context.Context, t *SurgeThreshold) error
	DeleteSurgeThreshold(ctx context.Context, id uuid.UUID) error

	InsertPricingAuditLog(ctx context.Context, adminID uuid.UUID, action, entityType string, entityID uuid.UUID, oldValues, newValues map[string]interface{}, reason string)
	GetPricingAuditLogs(ctx context.Context, entityType string, entityID *uuid.UUID, limit, offset int) ([]*PricingAuditLog, int64, error)
}
