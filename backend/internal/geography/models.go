package geography

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
)

type Country struct {
	ID                      uuid.UUID  `json:"id" gorm:"primaryKey;type:uuid"`
	Code                    string     `json:"code" gorm:"type:varchar(2);uniqueIndex"`
	Code3                   string     `json:"code3" gorm:"type:varchar(3);uniqueIndex"`
	Name                    string     `json:"name" gorm:"type:varchar(100);index"`
	NativeName              *string    `json:"native_name,omitempty" gorm:"type:varchar(100)"`
	CurrencyCode            string     `json:"currency_code" gorm:"type:varchar(3)"`
	DefaultLanguage         string     `json:"default_language" gorm:"type:varchar(10)"`
	Timezone                string     `json:"timezone" gorm:"type:varchar(50)"`
	PhonePrefix             string     `json:"phone_prefix" gorm:"type:varchar(10)"`
	IsActive                bool       `json:"is_active" gorm:"default:true;index"`
	LaunchedAt              *time.Time `json:"launched_at,omitempty"`
	PaymentMethods          JSON       `json:"payment_methods,omitempty" gorm:"type:jsonb"`
	RequiredDriverDocuments JSON       `json:"required_driver_documents" gorm:"type:jsonb"`
	CreatedAt               time.Time  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt               time.Time  `json:"updated_at" gorm:"autoUpdateTime"`
}

type Region struct {
	ID         uuid.UUID  `json:"id" gorm:"primaryKey;type:uuid"`
	CountryID  uuid.UUID  `json:"country_id" gorm:"type:uuid;index"`
	Code       string     `json:"code" gorm:"type:varchar(10);index"`
	Name       string     `json:"name" gorm:"type:varchar(100);index"`
	NativeName *string    `json:"native_name,omitempty" gorm:"type:varchar(100)"`
	Timezone   *string    `json:"timezone,omitempty" gorm:"type:varchar(50)"`
	IsActive   bool       `json:"is_active" gorm:"default:true;index"`
	LaunchedAt *time.Time `json:"launched_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt  time.Time  `json:"updated_at" gorm:"autoUpdateTime"`

	Country *Country `json:"country,omitempty" gorm:"foreignKey:CountryID"`
}

type City struct {
	ID              uuid.UUID  `json:"id" gorm:"primaryKey;type:uuid"`
	RegionID        uuid.UUID  `json:"region_id" gorm:"type:uuid;index"`
	Name            string     `json:"name" gorm:"type:varchar(100);index"`
	NativeName      *string    `json:"native_name,omitempty" gorm:"type:varchar(100)"`
	Timezone        *string    `json:"timezone,omitempty" gorm:"type:varchar(50)"`
	CenterLatitude  float64    `json:"center_latitude"`
	CenterLongitude float64    `json:"center_longitude"`
	Boundary        *string    `json:"boundary,omitempty" gorm:"type:text"`
	Population      *int       `json:"population,omitempty"`
	IsActive        bool       `json:"is_active" gorm:"default:true;index"`
	LaunchedAt      *time.Time `json:"launched_at,omitempty"`
	CreatedAt       time.Time  `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt       time.Time  `json:"updated_at" gorm:"autoUpdateTime"`

	Region *Region `json:"region,omitempty" gorm:"foreignKey:RegionID"`
}

type PricingZone struct {
	ID              uuid.UUID `json:"id" gorm:"primaryKey;type:uuid"`
	CityID          uuid.UUID `json:"city_id" gorm:"type:uuid;index"`
	Name            string    `json:"name" gorm:"type:varchar(100);index"`
	ZoneType        string    `json:"zone_type" gorm:"type:varchar(50);index"`
	Boundary        string    `json:"boundary" gorm:"type:text"`
	CenterLatitude  float64   `json:"center_latitude"`
	CenterLongitude float64   `json:"center_longitude"`
	Priority        int       `json:"priority" gorm:"default:0"`
	IsActive        bool      `json:"is_active" gorm:"default:true;index"`
	Metadata        JSON      `json:"metadata" gorm:"type:jsonb"`
	CreatedAt       time.Time `json:"created_at" gorm:"autoCreateTime"`
	UpdatedAt       time.Time `json:"updated_at" gorm:"autoUpdateTime"`

	City *City `json:"city,omitempty" gorm:"foreignKey:CityID"`
}

type JSON map[string]interface{}

func (j JSON) Value() (driver.Value, error) {
	if j == nil {
		return nil, nil
	}
	return json.Marshal(j)
}

func (j *JSON) Scan(value interface{}) error {
	if value == nil {
		*j = nil
		return nil
	}
	bytes, ok := value.([]byte)
	if !ok {
		return fmt.Errorf("failed to unmarshal JSONB value: %v", value)
	}

	result := make(map[string]interface{})
	err := json.Unmarshal(bytes, &result)
	*j = result
	return err
}

type Location struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

type ResolvedLocation struct {
	Location    Location     `json:"location"`
	Country     *Country     `json:"country,omitempty"`
	Region      *Region      `json:"region,omitempty"`
	City        *City        `json:"city,omitempty"`
	PricingZone *PricingZone `json:"pricing_zone,omitempty"`
	Timezone    string       `json:"timezone"`
}

type DriverRegion struct {
	ID         uuid.UUID  `json:"id" gorm:"primaryKey;type:uuid"`
	DriverID   uuid.UUID  `json:"driver_id" gorm:"type:uuid;index"`
	RegionID   uuid.UUID  `json:"region_id" gorm:"type:uuid;index"`
	IsPrimary  bool       `json:"is_primary" gorm:"default:false"`
	IsVerified bool       `json:"is_verified" gorm:"default:false"`
	VerifiedAt *time.Time `json:"verified_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at" gorm:"autoCreateTime"`

	Region *Region `json:"region,omitempty" gorm:"foreignKey:RegionID"`
}

const (
	ZoneTypeAirport        = "airport"
	ZoneTypeDowntown       = "downtown"
	ZoneTypeTransitHub     = "transit_hub"
	ZoneTypeEventVenue     = "event_venue"
	ZoneTypeBorderCrossing = "border_crossing"
	ZoneTypeTollZone       = "toll_zone"
)

type CountryResponse struct {
	ID             uuid.UUID `json:"id"`
	Code           string    `json:"code"`
	Name           string    `json:"name"`
	NativeName     *string   `json:"native_name,omitempty"`
	CurrencyCode   string    `json:"currency_code"`
	Timezone       string    `json:"timezone"`
	PhonePrefix    string    `json:"phone_prefix"`
	IsActive       bool      `json:"is_active"`
	PaymentMethods []string  `json:"payment_methods,omitempty"`
}

type RegionResponse struct {
	ID         uuid.UUID        `json:"id"`
	Code       string           `json:"code"`
	Name       string           `json:"name"`
	NativeName *string          `json:"native_name,omitempty"`
	Timezone   string           `json:"timezone"`
	IsActive   bool             `json:"is_active"`
	Country    *CountryResponse `json:"country,omitempty"`
}

type CityResponse struct {
	ID              uuid.UUID       `json:"id"`
	Name            string          `json:"name"`
	NativeName      *string         `json:"native_name,omitempty"`
	Timezone        string          `json:"timezone"`
	CenterLatitude  float64         `json:"center_latitude"`
	CenterLongitude float64         `json:"center_longitude"`
	Population      *int            `json:"population,omitempty"`
	IsActive        bool            `json:"is_active"`
	Region          *RegionResponse `json:"region,omitempty"`
}

type ResolveLocationRequest struct {
	Latitude  float64 `json:"latitude" binding:"required"`
	Longitude float64 `json:"longitude" binding:"required"`
}

type ResolveLocationResponse struct {
	Country     *CountryResponse     `json:"country,omitempty"`
	Region      *RegionResponse      `json:"region,omitempty"`
	City        *CityResponse        `json:"city,omitempty"`
	PricingZone *PricingZoneResponse `json:"pricing_zone,omitempty"`
	Timezone    string               `json:"timezone"`
}

type PricingZoneResponse struct {
	ID       uuid.UUID `json:"id"`
	Name     string    `json:"name"`
	ZoneType string    `json:"zone_type"`
	Priority int       `json:"priority"`
}

type CreateCountryRequest struct {
	Code                    string  `json:"code" binding:"required,len=2"`
	Code3                   string  `json:"code3" binding:"required,len=3"`
	Name                    string  `json:"name" binding:"required"`
	NativeName              *string `json:"native_name,omitempty"`
	CurrencyCode            string  `json:"currency_code" binding:"required,len=3"`
	DefaultLanguage         string  `json:"default_language" binding:"required"`
	Timezone                string  `json:"timezone" binding:"required"`
	PhonePrefix             string  `json:"phone_prefix" binding:"required"`
	IsActive                bool    `json:"is_active"`
	Regulations             JSON    `json:"regulations,omitempty"`
	PaymentMethods          JSON    `json:"payment_methods,omitempty"`
	RequiredDriverDocuments JSON    `json:"required_driver_documents,omitempty"`
}

type UpdateCountryRequest struct {
	Code                    *string `json:"code,omitempty"`
	Code3                   *string `json:"code3,omitempty"`
	Name                    *string `json:"name,omitempty"`
	NativeName              *string `json:"native_name,omitempty"`
	CurrencyCode            *string `json:"currency_code,omitempty"`
	DefaultLanguage         *string `json:"default_language,omitempty"`
	Timezone                *string `json:"timezone,omitempty"`
	PhonePrefix             *string `json:"phone_prefix,omitempty"`
	IsActive                *bool   `json:"is_active,omitempty"`
	Regulations             JSON    `json:"regulations,omitempty"`
	PaymentMethods          JSON    `json:"payment_methods,omitempty"`
	RequiredDriverDocuments JSON    `json:"required_driver_documents,omitempty"`
}

type CreateRegionRequest struct {
	Code       string  `json:"code" binding:"required"`
	Name       string  `json:"name" binding:"required"`
	NativeName *string `json:"native_name,omitempty"`
	Timezone   *string `json:"timezone,omitempty"`
	IsActive   bool    `json:"is_active"`
}

type UpdateRegionRequest struct {
	Code       *string `json:"code,omitempty"`
	Name       *string `json:"name,omitempty"`
	NativeName *string `json:"native_name,omitempty"`
	Timezone   *string `json:"timezone,omitempty"`
	IsActive   *bool   `json:"is_active,omitempty"`
}

type CreateCityRequest struct {
	Name            string  `json:"name" binding:"required"`
	NativeName      *string `json:"native_name,omitempty"`
	Timezone        *string `json:"timezone,omitempty"`
	CenterLatitude  float64 `json:"center_latitude" binding:"required"`
	CenterLongitude float64 `json:"center_longitude" binding:"required"`
	Boundary        *string `json:"boundary,omitempty"`
	Population      *int    `json:"population,omitempty"`
	IsActive        bool    `json:"is_active"`
}

type UpdateCityRequest struct {
	Name            *string  `json:"name,omitempty"`
	NativeName      *string  `json:"native_name,omitempty"`
	Timezone        *string  `json:"timezone,omitempty"`
	CenterLatitude  *float64 `json:"center_latitude,omitempty"`
	CenterLongitude *float64 `json:"center_longitude,omitempty"`
	Boundary        *string  `json:"boundary,omitempty"`
	Population      *int     `json:"population,omitempty"`
	IsActive        *bool    `json:"is_active,omitempty"`
}

type CreateZoneRequest struct {
	Name            string  `json:"name" binding:"required"`
	ZoneType        string  `json:"zone_type" binding:"required"`
	Boundary        string  `json:"boundary" binding:"required"`
	CenterLatitude  float64 `json:"center_latitude" binding:"required"`
	CenterLongitude float64 `json:"center_longitude" binding:"required"`
	Priority        int     `json:"priority"`
	IsActive        bool    `json:"is_active"`
	Metadata        JSON    `json:"metadata,omitempty"`
}

type UpdateZoneRequest struct {
	Name            *string  `json:"name,omitempty"`
	ZoneType        *string  `json:"zone_type,omitempty"`
	Boundary        *string  `json:"boundary,omitempty"`
	CenterLatitude  *float64 `json:"center_latitude,omitempty"`
	CenterLongitude *float64 `json:"center_longitude,omitempty"`
	Priority        *int     `json:"priority,omitempty"`
	IsActive        *bool    `json:"is_active,omitempty"`
	Metadata        JSON     `json:"metadata,omitempty"`
}

type GeographyStats struct {
	Countries    EntityStats `json:"countries"`
	Regions      EntityStats `json:"regions"`
	Cities       EntityStats `json:"cities"`
	PricingZones EntityStats `json:"pricing_zones"`
}

type EntityStats struct {
	Total  int64 `json:"total"`
	Active int64 `json:"active"`
}
