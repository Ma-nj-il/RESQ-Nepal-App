package ridetypes

import (
	"context"
	"fmt"

	"github.com/bikky-kc013/medi-ambulance/pkg/database"
	"github.com/google/uuid"
	"gorm.io/gorm/clause"
)

// Repository handles database operations for ride types
type Repository struct {
	db *database.DBPool
}

// NewRepository creates a new ride types repository
func NewRepository(db *database.DBPool) *Repository {
	return &Repository{db: db}
}

// CreateRideType creates a new ride type
func (r *Repository) CreateRideType(ctx context.Context, rt *RideType) error {
	if rt.ID == uuid.Nil {
		rt.ID = uuid.New()
	}
	err := r.db.Primary.WithContext(ctx).Create(rt).Error
	if err != nil {
		return fmt.Errorf("failed to create ride type: %w", err)
	}
	return nil
}

// GetRideTypeByID retrieves a ride type by ID
func (r *Repository) GetRideTypeByID(ctx context.Context, id uuid.UUID) (*RideType, error) {
	var rt RideType
	err := r.db.Primary.WithContext(ctx).First(&rt, "id = ?", id).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get ride type: %w", err)
	}
	return &rt, nil
}

// ListRideTypes lists ride types with pagination
func (r *Repository) ListRideTypes(ctx context.Context, limit, offset int, includeInactive bool) ([]*RideType, int64, error) {
	var total int64
	var items []*RideType

	query := r.db.Primary.WithContext(ctx).Model(&RideType{})
	if !includeInactive {
		query = query.Where("is_active = ?", true)
	}

	err := query.Count(&total).Error
	if err != nil {
		return nil, 0, fmt.Errorf("failed to count ride types: %w", err)
	}

	err = query.Order("sort_order, name").Limit(limit).Offset(offset).Find(&items).Error
	if err != nil {
		return nil, 0, fmt.Errorf("failed to list ride types: %w", err)
	}

	return items, total, nil
}

// UpdateRideType updates a ride type
func (r *Repository) UpdateRideType(ctx context.Context, rt *RideType) error {
	err := r.db.Primary.WithContext(ctx).Save(rt).Error
	if err != nil {
		return fmt.Errorf("failed to update ride type: %w", err)
	}
	return nil
}

// DeleteRideType soft-deletes a ride type
func (r *Repository) DeleteRideType(ctx context.Context, id uuid.UUID) error {
	err := r.db.Primary.WithContext(ctx).Model(&RideType{}).Where("id = ?", id).Update("is_active", false).Error
	if err != nil {
		return fmt.Errorf("failed to delete ride type: %w", err)
	}
	return nil
}

// --- Country Ride Types ---

// AddRideTypeToCountry adds a ride type to a country
func (r *Repository) AddRideTypeToCountry(ctx context.Context, crt *CountryRideType) error {
	err := r.db.Primary.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "country_id"}, {Name: "ride_type_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"is_active", "sort_order"}),
	}).Create(crt).Error
	if err != nil {
		return fmt.Errorf("failed to add ride type to country: %w", err)
	}
	return nil
}

// UpdateCountryRideType updates a country ride type mapping
func (r *Repository) UpdateCountryRideType(ctx context.Context, crt *CountryRideType) error {
	err := r.db.Primary.WithContext(ctx).Model(crt).Where("country_id = ? AND ride_type_id = ?", crt.CountryID, crt.RideTypeID).
		Updates(map[string]interface{}{
			"is_active":  crt.IsActive,
			"sort_order": crt.SortOrder,
		}).Error
	if err != nil {
		return fmt.Errorf("failed to update country ride type: %w", err)
	}
	return nil
}

// RemoveRideTypeFromCountry removes a ride type from a country
func (r *Repository) RemoveRideTypeFromCountry(ctx context.Context, countryID, rideTypeID uuid.UUID) error {
	err := r.db.Primary.WithContext(ctx).Delete(&CountryRideType{}, "country_id = ? AND ride_type_id = ?", countryID, rideTypeID).Error
	if err != nil {
		return fmt.Errorf("failed to remove ride type from country: %w", err)
	}
	return nil
}

// ListCountryRideTypes lists ride types for a country with details
func (r *Repository) ListCountryRideTypes(ctx context.Context, countryID uuid.UUID, includeInactive bool) ([]*CountryRideTypeWithDetails, error) {
	var items []*CountryRideTypeWithDetails
	query := r.db.Primary.WithContext(ctx).Table("country_ride_types crt").
		Select("crt.*, rt.name as ride_type_name, rt.description as ride_type_description, rt.icon as ride_type_icon, rt.capacity as ride_type_capacity").
		Joins("JOIN ride_types rt ON rt.id = crt.ride_type_id").
		Where("crt.country_id = ?", countryID)

	if !includeInactive {
		query = query.Where("crt.is_active = ? AND rt.is_active = ?", true, true)
	}

	err := query.Order("crt.sort_order, rt.name").Scan(&items).Error
	if err != nil {
		return nil, fmt.Errorf("failed to list country ride types: %w", err)
	}
	return items, nil
}

// --- City Ride Types ---

// AddRideTypeToCity adds a ride type to a city
func (r *Repository) AddRideTypeToCity(ctx context.Context, crt *CityRideType) error {
	err := r.db.Primary.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "city_id"}, {Name: "ride_type_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"is_active", "sort_order"}),
	}).Create(crt).Error
	if err != nil {
		return fmt.Errorf("failed to add ride type to city: %w", err)
	}
	return nil
}

// UpdateCityRideType updates a city ride type mapping
func (r *Repository) UpdateCityRideType(ctx context.Context, crt *CityRideType) error {
	err := r.db.Primary.WithContext(ctx).Model(crt).Where("city_id = ? AND ride_type_id = ?", crt.CityID, crt.RideTypeID).
		Updates(map[string]interface{}{
			"is_active":  crt.IsActive,
			"sort_order": crt.SortOrder,
		}).Error
	if err != nil {
		return fmt.Errorf("failed to update city ride type: %w", err)
	}
	return nil
}

// RemoveRideTypeFromCity removes a ride type from a city
func (r *Repository) RemoveRideTypeFromCity(ctx context.Context, cityID, rideTypeID uuid.UUID) error {
	err := r.db.Primary.WithContext(ctx).Delete(&CityRideType{}, "city_id = ? AND ride_type_id = ?", cityID, rideTypeID).Error
	if err != nil {
		return fmt.Errorf("failed to remove ride type from city: %w", err)
	}
	return nil
}

// ListCityRideTypes lists ride types for a city with details
func (r *Repository) ListCityRideTypes(ctx context.Context, cityID uuid.UUID, includeInactive bool) ([]*CityRideTypeWithDetails, error) {
	var items []*CityRideTypeWithDetails
	query := r.db.Primary.WithContext(ctx).Table("city_ride_types crt").
		Select("crt.*, rt.name as ride_type_name, rt.description as ride_type_description, rt.icon as ride_type_icon, rt.capacity as ride_type_capacity").
		Joins("JOIN ride_types rt ON rt.id = crt.ride_type_id").
		Where("crt.city_id = ?", cityID)

	if !includeInactive {
		query = query.Where("crt.is_active = ? AND rt.is_active = ?", true, true)
	}

	err := query.Order("crt.sort_order, rt.name").Scan(&items).Error
	if err != nil {
		return nil, fmt.Errorf("failed to list city ride types: %w", err)
	}
	return items, nil
}

// GetAvailableRideTypes returns active ride types for a resolved location using cascading logic:
//  1. If city_ride_types rows exist for this city → use those (city-level overrides)
//  2. Else if country_ride_types rows exist → use those (country-level, available in all cities)
//  3. Else → return all active ride types (global fallback)
func (r *Repository) GetAvailableRideTypes(ctx context.Context, countryID, cityID *uuid.UUID) ([]*RideType, error) {
	// Try city-level first
	if cityID != nil {
		var items []*RideType
		query := `
			SELECT rt.*, COALESCE(crt.sort_order, rt.sort_order) AS sort_order
			FROM ride_types rt
			JOIN city_ride_types crt ON crt.ride_type_id = rt.id
			WHERE crt.city_id = ?
			  AND crt.is_active = true
			  AND rt.is_active = true
			ORDER BY crt.sort_order, rt.name
		`
		err := r.db.Primary.WithContext(ctx).Raw(query, *cityID).Scan(&items).Error
		if err == nil && len(items) > 0 {
			return items, nil
		}
	}

	// Try country-level
	if countryID != nil {
		var items []*RideType
		query := `
			SELECT rt.*, COALESCE(crt.sort_order, rt.sort_order) AS sort_order
			FROM ride_types rt
			JOIN country_ride_types crt ON crt.ride_type_id = rt.id
			WHERE crt.country_id = ?
			  AND crt.is_active = true
			  AND rt.is_active = true
			ORDER BY crt.sort_order, rt.name
		`
		err := r.db.Primary.WithContext(ctx).Raw(query, *countryID).Scan(&items).Error
		if err == nil && len(items) > 0 {
			return items, nil
		}
	}

	// Global fallback: all active ride types
	var items []*RideType
	err := r.db.Primary.WithContext(ctx).Where("is_active = ?", true).Order("sort_order, name").Find(&items).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get active ride types: %w", err)
	}
	return items, nil
}
