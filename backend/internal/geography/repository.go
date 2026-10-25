package geography

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/bikky-kc013/medi-ambulance/pkg/database"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type Repository struct {
	db *database.DBPool
}

func NewRepository(db *database.DBPool) *Repository {
	return &Repository{db: db}
}

// GetActiveCountries retrieves all active countries
func (r *Repository) GetActiveCountries(ctx context.Context) ([]*Country, error) {
	var countries []*Country
	err := r.db.Primary.WithContext(ctx).
		Where("is_active = ?", true).
		Order("name").
		Find(&countries).Error

	if err != nil {
		return nil, fmt.Errorf("failed to get countries: %w", err)
	}

	return countries, nil
}

// GetCountryByCode retrieves a country by its ISO code
func (r *Repository) GetCountryByCode(ctx context.Context, code string) (*Country, error) {
	var country Country
	err := r.db.Primary.WithContext(ctx).
		Where("code = ?", code).
		First(&country).Error

	if err != nil {
		return nil, fmt.Errorf("failed to get country: %w", err)
	}

	return &country, nil
}

// GetCountryByID retrieves a country by its ID
func (r *Repository) GetCountryByID(ctx context.Context, id uuid.UUID) (*Country, error) {
	var country Country
	err := r.db.Primary.WithContext(ctx).
		First(&country, "id = ?", id).Error

	if err != nil {
		return nil, fmt.Errorf("failed to get country: %w", err)
	}

	return &country, nil
}

// GetRegionsByCountry retrieves all active regions for a country
func (r *Repository) GetRegionsByCountry(ctx context.Context, countryID uuid.UUID) ([]*Region, error) {
	var regions []*Region
	err := r.db.Primary.WithContext(ctx).
		Preload("Country").
		Where("country_id = ? AND is_active = ?", countryID, true).
		Order("name").
		Find(&regions).Error

	if err != nil {
		return nil, fmt.Errorf("failed to get regions: %w", err)
	}

	return regions, nil
}

// GetRegionByID retrieves a region by its ID with country info
func (r *Repository) GetRegionByID(ctx context.Context, id uuid.UUID) (*Region, error) {
	var reg Region
	err := r.db.Primary.WithContext(ctx).
		Preload("Country").
		First(&reg, "id = ?", id).Error

	if err != nil {
		return nil, fmt.Errorf("failed to get region: %w", err)
	}

	return &reg, nil
}

// GetCitiesByRegion retrieves all active cities for a region
func (r *Repository) GetCitiesByRegion(ctx context.Context, regionID uuid.UUID) ([]*City, error) {
	var cities []*City
	err := r.db.Primary.WithContext(ctx).
		Select("id, region_id, name, native_name, timezone, center_latitude, center_longitude, ST_AsText(boundary) AS boundary, population, is_active, launched_at, created_at, updated_at").
		Where("region_id = ? AND is_active = ?", regionID, true).
		Order("name").
		Find(&cities).Error

	if err != nil {
		return nil, fmt.Errorf("failed to get cities: %w", err)
	}

	return cities, nil
}

// GetCityByID retrieves a city by its ID with region and country
func (r *Repository) GetCityByID(ctx context.Context, id uuid.UUID) (*City, error) {
	var city City
	err := r.db.Primary.WithContext(ctx).
		Select("*, ST_AsText(boundary) AS boundary").
		Preload("Region").
		Preload("Region.Country").
		First(&city, "id = ?", id).Error

	if err != nil {
		return nil, fmt.Errorf("failed to get city: %w", err)
	}

	return &city, nil
}

// ResolveLocation finds the geographic hierarchy for a latitude/longitude point
func (r *Repository) ResolveLocation(ctx context.Context, latitude, longitude float64) (*ResolvedLocation, error) {
	result := &ResolvedLocation{
		Location: Location{Latitude: latitude, Longitude: longitude},
	}

	// Find city containing the point (uses PostGIS ST_Contains)
	cityQuery := `
		SELECT city.id, city.region_id, city.name, city.native_name, city.timezone,
		       city.center_latitude, city.center_longitude, ST_AsText(city.boundary) AS boundary,
		       city.population, city.is_active, city.launched_at, city.created_at, city.updated_at
		FROM cities city
		JOIN regions reg ON city.region_id = reg.id
		JOIN countries c ON reg.country_id = c.id
		WHERE city.is_active = true
		  AND reg.is_active = true
		  AND c.is_active = true
		  AND ST_Contains(city.boundary, ST_SetSRID(ST_MakePoint(?, ?), 4326))
		ORDER BY city.population DESC NULLS LAST
		LIMIT 1
	`

	var city City
	err := r.db.Primary.WithContext(ctx).Raw(cityQuery, longitude, latitude).Scan(&city).Error
	if err == nil && city.ID != uuid.Nil {
		// Load hierarchy
		r.db.Primary.WithContext(ctx).Preload("Region").Preload("Region.Country").First(&city, "id = ?", city.ID)
		result.City = &city
		result.Region = city.Region
		result.Country = city.Region.Country

		// Resolve timezone (city > region > country)
		if city.Timezone != nil && *city.Timezone != "" {
			result.Timezone = *city.Timezone
		} else if city.Region.Timezone != nil && *city.Region.Timezone != "" {
			result.Timezone = *city.Region.Timezone
		} else {
			result.Timezone = city.Region.Country.Timezone
		}

		// Find pricing zone containing the point (highest priority)
		zoneQuery := `
			SELECT id, city_id, name, zone_type, ST_AsText(boundary) AS boundary,
			       center_latitude, center_longitude, priority, is_active,
			       metadata, created_at, updated_at
			FROM pricing_zones
			WHERE city_id = ?
			  AND is_active = true
			  AND ST_Contains(boundary, ST_SetSRID(ST_MakePoint(?, ?), 4326))
			ORDER BY priority DESC
			LIMIT 1
		`

		var zone PricingZone
		if err := r.db.Primary.WithContext(ctx).Raw(zoneQuery, result.City.ID, longitude, latitude).Scan(&zone).Error; err == nil && zone.ID != uuid.Nil {
			result.PricingZone = &zone
		}
	}

	return result, nil
}

// FindNearestCity finds the nearest city to a point
func (r *Repository) FindNearestCity(ctx context.Context, latitude, longitude float64, maxDistanceKm float64) (*City, error) {
	query := `
		SELECT city.*,
		       ST_Distance(
		           ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography,
		           ST_SetSRID(ST_MakePoint(city.center_longitude, city.center_latitude), 4326)::geography
		       ) / 1000.0 AS distance_km
		FROM cities city
		WHERE city.is_active = true
		ORDER BY distance_km
		LIMIT 1
	`

	type Result struct {
		City
		DistanceKm float64 `gorm:"column:distance_km"`
	}

	var res Result
	err := r.db.Primary.WithContext(ctx).Raw(query, longitude, latitude).Scan(&res).Error
	if err != nil {
		return nil, fmt.Errorf("failed to find nearest city: %w", err)
	}

	if res.DistanceKm > maxDistanceKm {
		return nil, fmt.Errorf("nearest city is %.2f km away, exceeds max %.2f km", res.DistanceKm, maxDistanceKm)
	}

	return &res.City, nil
}

// GetPricingZonesByCity retrieves all active pricing zones for a city
func (r *Repository) GetPricingZonesByCity(ctx context.Context, cityID uuid.UUID) ([]*PricingZone, error) {
	var zones []*PricingZone
	err := r.db.Primary.WithContext(ctx).
		Select("id, city_id, name, zone_type, ST_AsText(boundary) AS boundary, center_latitude, center_longitude, priority, is_active, metadata, created_at, updated_at").
		Where("city_id = ? AND is_active = ?", cityID, true).
		Order("priority DESC, name").
		Find(&zones).Error

	if err != nil {
		return nil, fmt.Errorf("failed to get pricing zones: %w", err)
	}

	return zones, nil
}

// GetDriverRegions retrieves all operating regions for a driver
func (r *Repository) GetDriverRegions(ctx context.Context, driverID uuid.UUID) ([]*DriverRegion, error) {
	var regions []*DriverRegion
	err := r.db.Primary.WithContext(ctx).
		Preload("Region").
		Preload("Region.Country").
		Where("driver_id = ?", driverID).
		Joins("JOIN regions ON driver_regions.region_id = regions.id").
		Order("is_primary DESC, regions.name").
		Find(&regions).Error

	if err != nil {
		return nil, fmt.Errorf("failed to get driver regions: %w", err)
	}

	return regions, nil
}

// AddDriverRegion adds a new operating region for a driver
func (r *Repository) AddDriverRegion(ctx context.Context, driverID, regionID uuid.UUID, isPrimary bool) error {
	return r.db.Primary.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// If setting as primary, unset other primary regions first
		if isPrimary {
			if err := tx.Model(&DriverRegion{}).Where("driver_id = ?", driverID).Update("is_primary", false).Error; err != nil {
				return fmt.Errorf("failed to unset primary region: %w", err)
			}
		}

		dr := DriverRegion{
			ID:        uuid.New(),
			DriverID:  driverID,
			RegionID:  regionID,
			IsPrimary: isPrimary,
		}

		err := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "driver_id"}, {Name: "region_id"}},
			DoUpdates: clause.Assignments(map[string]interface{}{"is_primary": isPrimary}),
		}).Create(&dr).Error

		if err != nil {
			return fmt.Errorf("failed to add driver region: %w", err)
		}

		return nil
	})
}

// marshalJSON marshals a JSON map to bytes, defaulting to {} if nil
func marshalJSON(j JSON) []byte {
	if j == nil {
		return []byte("{}")
	}
	b, err := json.Marshal(j)
	if err != nil {
		return []byte("{}")
	}
	return b
}

func (r *Repository) CreateCountry(ctx context.Context, country *Country) error {
	if country.ID == uuid.Nil {
		country.ID = uuid.New()
	}
	err := r.db.Primary.WithContext(ctx).Create(country).Error
	if err != nil {
		return fmt.Errorf("failed to create country: %w", err)
	}
	return nil
}

func (r *Repository) CreateRegion(ctx context.Context, region *Region) error {
	if region.ID == uuid.Nil {
		region.ID = uuid.New()
	}
	err := r.db.Primary.WithContext(ctx).Create(region).Error
	if err != nil {
		return fmt.Errorf("failed to create region: %w", err)
	}
	return nil
}

// CreateCity creates a new city
func (r *Repository) CreateCity(ctx context.Context, city *City) error {
	if city.ID == uuid.Nil {
		city.ID = uuid.New()
	}
	// Handle geometry via raw SQL or custom valuer if needed, but since we have a string field for WKT:
	// If city.Boundary is provided, we might need a raw query or a custom type.
	// Let's use raw query for spatial inserts to be safe.
	query := `
		INSERT INTO cities (id, region_id, name, native_name, timezone, center_latitude, center_longitude, boundary, population, is_active)
		VALUES (?, ?, ?, ?, ?, ?, ?, ST_GeomFromText(?, 4326), ?, ?)
	`
	err := r.db.Primary.WithContext(ctx).Exec(query,
		city.ID, city.RegionID, city.Name, city.NativeName, city.Timezone,
		city.CenterLatitude, city.CenterLongitude, city.Boundary, city.Population, city.IsActive,
	).Error

	if err != nil {
		return fmt.Errorf("failed to create city: %w", err)
	}

	return nil
}

// GetAllCountries retrieves all countries with pagination and search
func (r *Repository) GetAllCountries(ctx context.Context, limit, offset int, search string) ([]*Country, int64, error) {
	var countries []*Country
	var total int64
	db := r.db.Primary.WithContext(ctx).Model(&Country{})

	if search != "" {
		s := "%" + search + "%"
		db = db.Where("name ILIKE ? OR code ILIKE ? OR native_name ILIKE ?", s, s, s)
	}

	if err := db.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to count countries: %w", err)
	}

	err := db.Order("name").Limit(limit).Offset(offset).Find(&countries).Error
	if err != nil {
		return nil, 0, fmt.Errorf("failed to get countries: %w", err)
	}

	return countries, total, nil
}

// GetAllRegions retrieves all regions for a country with pagination and search
func (r *Repository) GetAllRegions(ctx context.Context, countryID *uuid.UUID, limit, offset int, search string) ([]*Region, int64, error) {
	var regions []*Region
	var total int64
	db := r.db.Primary.WithContext(ctx).Model(&Region{})

	if countryID != nil {
		db = db.Where("country_id = ?", *countryID)
	}
	if search != "" {
		s := "%" + search + "%"
		db = db.Where("name ILIKE ? OR code ILIKE ? OR native_name ILIKE ?", s, s, s)
	}

	if err := db.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to count regions: %w", err)
	}

	err := db.Order("name").Limit(limit).Offset(offset).Find(&regions).Error
	if err != nil {
		return nil, 0, fmt.Errorf("failed to get regions: %w", err)
	}

	return regions, total, nil
}

// GetAllCities retrieves all cities for a region with pagination and search
func (r *Repository) GetAllCities(ctx context.Context, regionID *uuid.UUID, limit, offset int, search string) ([]*City, int64, error) {
	var cities []*City
	var total int64
	db := r.db.Primary.WithContext(ctx).Model(&City{})

	if regionID != nil {
		db = db.Where("region_id = ?", *regionID)
	}
	if search != "" {
		s := "%" + search + "%"
		db = db.Where("name ILIKE ? OR native_name ILIKE ?", s, s)
	}

	if err := db.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to count cities: %w", err)
	}

	err := db.Select("*, ST_AsText(boundary) AS boundary").Order("name").Limit(limit).Offset(offset).Find(&cities).Error
	if err != nil {
		return nil, 0, fmt.Errorf("failed to get cities: %w", err)
	}

	return cities, total, nil
}

// GetAllPricingZones retrieves all pricing zones for a city with pagination and search
func (r *Repository) GetAllPricingZones(ctx context.Context, cityID *uuid.UUID, limit, offset int, search string) ([]*PricingZone, int64, error) {
	var zones []*PricingZone
	var total int64
	db := r.db.Primary.WithContext(ctx).Model(&PricingZone{})

	if cityID != nil {
		db = db.Where("city_id = ?", *cityID)
	}
	if search != "" {
		s := "%" + search + "%"
		db = db.Where("name ILIKE ? OR zone_type ILIKE ?", s, s)
	}

	if err := db.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to count pricing zones: %w", err)
	}

	err := db.Select("*, ST_AsText(boundary) AS boundary").Order("priority DESC, name").Limit(limit).Offset(offset).Find(&zones).Error
	if err != nil {
		return nil, 0, fmt.Errorf("failed to get pricing zones: %w", err)
	}

	return zones, total, nil
}

// UpdateCountry updates a country
func (r *Repository) UpdateCountry(ctx context.Context, country *Country) error {
	err := r.db.Primary.WithContext(ctx).Save(country).Error
	if err != nil {
		return fmt.Errorf("failed to update country: %w", err)
	}
	return nil
}

// DeleteCountry soft-deletes a country by setting is_active to false
func (r *Repository) DeleteCountry(ctx context.Context, id uuid.UUID) error {
	err := r.db.Primary.WithContext(ctx).Model(&Country{}).Where("id = ?", id).Update("is_active", false).Error
	if err != nil {
		return fmt.Errorf("failed to delete country: %w", err)
	}
	return nil
}

// UpdateRegion updates a region
func (r *Repository) UpdateRegion(ctx context.Context, region *Region) error {
	err := r.db.Primary.WithContext(ctx).Save(region).Error
	if err != nil {
		return fmt.Errorf("failed to update region: %w", err)
	}
	return nil
}

// DeleteRegion soft-deletes a region by setting is_active to false
func (r *Repository) DeleteRegion(ctx context.Context, id uuid.UUID) error {
	err := r.db.Primary.WithContext(ctx).Model(&Region{}).Where("id = ?", id).Update("is_active", false).Error
	if err != nil {
		return fmt.Errorf("failed to delete region: %w", err)
	}
	return nil
}

// UpdateCity updates a city
func (r *Repository) UpdateCity(ctx context.Context, city *City) error {
	query := `
		UPDATE cities SET
			region_id = ?, name = ?, native_name = ?, timezone = ?,
			center_latitude = ?, center_longitude = ?,
			boundary = CASE WHEN ?::text IS NOT NULL THEN ST_GeomFromText(?, 4326) ELSE boundary END,
			population = ?, is_active = ?, updated_at = NOW()
		WHERE id = ?
	`

	err := r.db.Primary.WithContext(ctx).Exec(query,
		city.RegionID, city.Name, city.NativeName, city.Timezone,
		city.CenterLatitude, city.CenterLongitude, city.Boundary, city.Boundary,
		city.Population, city.IsActive, city.ID,
	).Error

	if err != nil {
		return fmt.Errorf("failed to update city: %w", err)
	}

	return nil
}

// DeleteCity soft-deletes a city by setting is_active to false
func (r *Repository) DeleteCity(ctx context.Context, id uuid.UUID) error {
	err := r.db.Primary.WithContext(ctx).Model(&City{}).Where("id = ?", id).Update("is_active", false).Error
	if err != nil {
		return fmt.Errorf("failed to delete city: %w", err)
	}
	return nil
}

// UpdatePricingZone updates a pricing zone
func (r *Repository) UpdatePricingZone(ctx context.Context, zone *PricingZone) error {
	query := `
		UPDATE pricing_zones SET
			city_id = ?, name = ?, zone_type = ?,
			boundary = ST_GeomFromText(?, 4326),
			center_latitude = ?, center_longitude = ?,
			priority = ?, is_active = ?, metadata = ?,
			updated_at = NOW()
		WHERE id = ?
	`

	err := r.db.Primary.WithContext(ctx).Exec(query,
		zone.CityID, zone.Name, zone.ZoneType, zone.Boundary,
		zone.CenterLatitude, zone.CenterLongitude, zone.Priority,
		zone.IsActive, zone.Metadata, zone.ID,
	).Error

	if err != nil {
		return fmt.Errorf("failed to update pricing zone: %w", err)
	}

	return nil
}

// DeletePricingZone soft-deletes a pricing zone by setting is_active to false
func (r *Repository) DeletePricingZone(ctx context.Context, id uuid.UUID) error {
	err := r.db.Primary.WithContext(ctx).Model(&PricingZone{}).Where("id = ?", id).Update("is_active", false).Error
	if err != nil {
		return fmt.Errorf("failed to delete pricing zone: %w", err)
	}
	return nil
}

// GetPricingZoneByID retrieves a pricing zone by its ID
func (r *Repository) GetPricingZoneByID(ctx context.Context, id uuid.UUID) (*PricingZone, error) {
	var zone PricingZone
	err := r.db.Primary.WithContext(ctx).
		Select("*, ST_AsText(boundary) AS boundary").
		First(&zone, "id = ?", id).Error

	if err != nil {
		return nil, fmt.Errorf("failed to get pricing zone: %w", err)
	}

	return &zone, nil
}

// GetGeographyStats returns aggregate counts for all geography entities
func (r *Repository) GetGeographyStats(ctx context.Context) (*GeographyStats, error) {
	var stats GeographyStats

	r.db.Primary.WithContext(ctx).Model(&Country{}).Count(&stats.Countries.Total)
	r.db.Primary.WithContext(ctx).Model(&Country{}).Where("is_active = ?", true).Count(&stats.Countries.Active)

	r.db.Primary.WithContext(ctx).Model(&Region{}).Count(&stats.Regions.Total)
	r.db.Primary.WithContext(ctx).Model(&Region{}).Where("is_active = ?", true).Count(&stats.Regions.Active)

	r.db.Primary.WithContext(ctx).Model(&City{}).Count(&stats.Cities.Total)
	r.db.Primary.WithContext(ctx).Model(&City{}).Where("is_active = ?", true).Count(&stats.Cities.Active)

	r.db.Primary.WithContext(ctx).Model(&PricingZone{}).Count(&stats.PricingZones.Total)
	r.db.Primary.WithContext(ctx).Model(&PricingZone{}).Where("is_active = ?", true).Count(&stats.PricingZones.Active)

	return &stats, nil
}

// CreatePricingZone creates a new pricing zone
func (r *Repository) CreatePricingZone(ctx context.Context, zone *PricingZone) error {
	if zone.ID == uuid.Nil {
		zone.ID = uuid.New()
	}

	query := `
		INSERT INTO pricing_zones (id, city_id, name, zone_type, boundary, center_latitude, center_longitude, priority, is_active, metadata)
		VALUES (?, ?, ?, ?, ST_GeomFromText(?, 4326), ?, ?, ?, ?, ?)
	`

	err := r.db.Primary.WithContext(ctx).Exec(query,
		zone.ID, zone.CityID, zone.Name, zone.ZoneType, zone.Boundary,
		zone.CenterLatitude, zone.CenterLongitude, zone.Priority,
		zone.IsActive, zone.Metadata,
	).Error

	if err != nil {
		return fmt.Errorf("failed to create pricing zone: %w", err)
	}

	return nil
}
