package pricing

import (
	"context"
	"fmt"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/database"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Repository struct {
	db *database.DBPool
}

func NewRepository(db *database.DBPool) *Repository {
	return &Repository{db: db}
}

func (r *Repository) GetActiveVersionID(ctx context.Context) (uuid.UUID, error) {
	var versionID uuid.UUID
	err := r.db.Primary.WithContext(ctx).Table("pricing_config_versions").
		Select("id").
		Where("status = ?", "active").
		Where("(effective_from IS NULL OR effective_from <= ?)", time.Now()).
		Where("(effective_until IS NULL OR effective_until > ?)", time.Now()).
		Order("effective_from DESC NULLS LAST").
		Limit(1).
		Row().Scan(&versionID)

	if err != nil {
		return uuid.Nil, fmt.Errorf("failed to get active pricing version: %w", err)
	}

	return versionID, nil
}

func (r *Repository) GetPricingConfigsForResolution(ctx context.Context, versionID uuid.UUID, countryID, regionID, cityID, zoneID, rideTypeID *uuid.UUID) ([]*PricingConfig, error) {
	query := `
		SELECT id, version_id, country_id, region_id, city_id, zone_id, ride_type_id,
		       base_fare, per_km_rate, per_minute_rate, minimum_fare, booking_fee,
		       platform_commission_pct, driver_incentive_pct,
		       surge_min_multiplier, surge_max_multiplier,
		       tax_rate_pct, tax_inclusive, cancellation_fees, is_active, created_at, updated_at
		FROM pricing_configs
		WHERE version_id = ?
		  AND is_active = true
		  AND (
		    -- Global config (no location scope)
		    (country_id IS NULL AND region_id IS NULL AND city_id IS NULL AND zone_id IS NULL)
		    -- Country level
		    OR (country_id = ? AND region_id IS NULL AND city_id IS NULL AND zone_id IS NULL)
		    -- Region level
		    OR (region_id = ? AND city_id IS NULL AND zone_id IS NULL)
		    -- City level
		    OR (city_id = ? AND zone_id IS NULL)
		    -- Zone level
		    OR zone_id = ?
		  )
		  AND (ride_type_id IS NULL OR ride_type_id = ?)
		ORDER BY
		  -- Hierarchy level (more specific = higher priority)
		  CASE
		    WHEN zone_id IS NOT NULL THEN 4
		    WHEN city_id IS NOT NULL THEN 3
		    WHEN region_id IS NOT NULL THEN 2
		    WHEN country_id IS NOT NULL THEN 1
		    ELSE 0
		  END DESC,
		  -- Ride type specificity (specific ride type > all ride types)
		  CASE WHEN ride_type_id IS NOT NULL THEN 1 ELSE 0 END DESC
	`

	var configs []*PricingConfig
	err := r.db.Primary.WithContext(ctx).Raw(query, versionID, countryID, regionID, cityID, zoneID, rideTypeID).Scan(&configs).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get pricing configs: %w", err)
	}

	return configs, nil
}

func (r *Repository) GetZoneFees(ctx context.Context, versionID uuid.UUID, pickupZoneID, dropoffZoneID *uuid.UUID, rideTypeID *uuid.UUID) ([]*ZoneFee, error) {
	if pickupZoneID == nil && dropoffZoneID == nil {
		return nil, nil
	}

	var fees []*ZoneFee
	err := r.db.Primary.WithContext(ctx).
		Where("version_id = ? AND is_active = true AND (zone_id = ? OR zone_id = ?) AND (ride_type_id IS NULL OR ride_type_id = ?)",
			versionID, pickupZoneID, dropoffZoneID, rideTypeID).
		Find(&fees).Error

	if err != nil {
		return nil, fmt.Errorf("failed to get zone fees: %w", err)
	}

	return fees, nil
}

func (r *Repository) GetTimeMultipliers(ctx context.Context, versionID uuid.UUID, countryID, regionID, cityID *uuid.UUID, t time.Time) ([]*TimeMultiplier, error) {
	dayOfWeek := int(t.Weekday())
	timeOfDay := t.Format("15:04")

	query := `
		SELECT id, version_id, country_id, region_id, city_id, name,
		       days_of_week, start_time, end_time, multiplier, priority,
		       is_active, created_at, updated_at
		FROM time_multipliers
		WHERE version_id = ?
		  AND is_active = true
		  AND ? = ANY(days_of_week)
		  AND (
		    (start_time <= end_time AND ?::time >= start_time AND ?::time <= end_time)
		    OR (start_time > end_time AND (?::time >= start_time OR ?::time <= end_time))
		  )
		  AND (
		    (country_id IS NULL AND region_id IS NULL AND city_id IS NULL)
		    OR (country_id = ? AND region_id IS NULL AND city_id IS NULL)
		    OR (region_id = ? AND city_id IS NULL)
		    OR city_id = ?
		  )
		ORDER BY priority DESC
		LIMIT 1
	`

	var multipliers []*TimeMultiplier
	err := r.db.Primary.WithContext(ctx).Raw(query, versionID, dayOfWeek, timeOfDay, timeOfDay, timeOfDay, countryID, regionID, cityID).Scan(&multipliers).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get time multipliers: %w", err)
	}

	return multipliers, nil
}

func (r *Repository) GetWeatherMultiplier(ctx context.Context, versionID uuid.UUID, countryID, regionID, cityID *uuid.UUID, condition string) (*WeatherMultiplier, error) {
	var m WeatherMultiplier
	err := r.db.Primary.WithContext(ctx).
		Where("version_id = ? AND is_active = true AND weather_condition = ?", versionID, condition).
		Where("(country_id IS NULL AND region_id IS NULL AND city_id IS NULL) OR (country_id = ? AND region_id IS NULL AND city_id IS NULL) OR (region_id = ? AND city_id IS NULL) OR city_id = ?", countryID, regionID, cityID).
		Order(`CASE WHEN city_id IS NOT NULL THEN 3 WHEN region_id IS NOT NULL THEN 2 WHEN country_id IS NOT NULL THEN 1 ELSE 0 END DESC`).
		First(&m).Error

	if err != nil {
		return nil, fmt.Errorf("failed to get weather multiplier: %w", err)
	}

	return &m, nil
}

func (r *Repository) GetActiveEventMultipliers(ctx context.Context, versionID uuid.UUID, cityID, zoneID *uuid.UUID, t time.Time) ([]*EventMultiplier, error) {
	query := `
		SELECT id, version_id, zone_id, city_id, event_name, event_type,
		       starts_at, ends_at, pre_event_minutes, post_event_minutes,
		       multiplier, expected_demand_increase, is_active, created_at
		FROM event_multipliers
		WHERE version_id = ?
		  AND is_active = true
		  AND (city_id = ? OR zone_id = ?)
		  AND ? >= (starts_at - (pre_event_minutes || ' minutes')::interval)
		  AND ? <= (ends_at + (post_event_minutes || ' minutes')::interval)
		ORDER BY multiplier DESC
		LIMIT 1
	`

	var multipliers []*EventMultiplier
	err := r.db.Primary.WithContext(ctx).Raw(query, versionID, cityID, zoneID, t, t).Scan(&multipliers).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get event multipliers: %w", err)
	}

	return multipliers, nil
}

func (r *Repository) GetSurgeThresholds(ctx context.Context, versionID uuid.UUID, countryID, regionID, cityID *uuid.UUID) ([]*SurgeThreshold, error) {
	var thresholds []*SurgeThreshold
	err := r.db.Primary.WithContext(ctx).
		Where("version_id = ? AND is_active = true", versionID).
		Where("(country_id IS NULL AND region_id IS NULL AND city_id IS NULL) OR (country_id = ? AND region_id IS NULL AND city_id IS NULL) OR (region_id = ? AND city_id IS NULL) OR city_id = ?", countryID, regionID, cityID).
		Order(`CASE WHEN city_id IS NOT NULL THEN 3 WHEN region_id IS NOT NULL THEN 2 WHEN country_id IS NOT NULL THEN 1 ELSE 0 END DESC, demand_supply_ratio_min ASC`).
		Find(&thresholds).Error

	if err != nil {
		return nil, fmt.Errorf("failed to get surge thresholds: %w", err)
	}

	return thresholds, nil
}

func (r *Repository) GetZoneName(ctx context.Context, zoneID uuid.UUID) (string, error) {
	var name string
	err := r.db.Primary.WithContext(ctx).Table("pricing_zones").
		Select("name").
		Where("id = ?", zoneID).
		Row().Scan(&name)
	if err != nil {
		return "", fmt.Errorf("failed to get zone name: %w", err)
	}
	return name, nil
}

func (r *Repository) CreateVersion(ctx context.Context, version *PricingConfigVersion) error {
	if version.ID == uuid.Nil {
		version.ID = uuid.New()
	}

	err := r.db.Primary.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var maxVersion int
		tx.Table("pricing_config_versions").Select("COALESCE(MAX(version_number), 0)").Row().Scan(&maxVersion)
		version.VersionNumber = maxVersion + 1
		version.Status = VersionStatusDraft

		return tx.Create(version).Error
	})

	if err != nil {
		return fmt.Errorf("failed to create version: %w", err)
	}
	return nil
}

func (r *Repository) GetVersionByID(ctx context.Context, id uuid.UUID) (*PricingConfigVersion, error) {
	var v PricingConfigVersion
	err := r.db.Primary.WithContext(ctx).First(&v, "id = ?", id).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get version: %w", err)
	}
	return &v, nil
}

func (r *Repository) ListVersions(ctx context.Context, limit, offset int, status string) ([]*PricingConfigVersion, int64, error) {
	var total int64
	var versions []*PricingConfigVersion

	query := r.db.Primary.WithContext(ctx).Model(&PricingConfigVersion{})
	if status != "" {
		query = query.Where("status = ?", status)
	}

	err := query.Count(&total).Error
	if err != nil {
		return nil, 0, fmt.Errorf("failed to count versions: %w", err)
	}

	err = query.Order("version_number DESC").Limit(limit).Offset(offset).Find(&versions).Error
	if err != nil {
		return nil, 0, fmt.Errorf("failed to list versions: %w", err)
	}

	return versions, total, nil
}

func (r *Repository) UpdateVersion(ctx context.Context, version *PricingConfigVersion) error {
	result := r.db.Primary.WithContext(ctx).
		Where("id = ? AND status = 'draft'", version.ID).
		Save(version)

	if result.Error != nil {
		return fmt.Errorf("failed to update version: %w", result.Error)
	}

	if result.RowsAffected == 0 {
		return fmt.Errorf("version not found or not in draft status")
	}

	return nil
}

func (r *Repository) ActivateVersion(ctx context.Context, id uuid.UUID, adminID uuid.UUID) error {
	err := r.db.Primary.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		err := tx.Model(&PricingConfigVersion{}).
			Where("status = ?", "active").
			Updates(map[string]interface{}{
				"status": "archived",
			}).Error
		if err != nil {
			return err
		}

		result := tx.Model(&PricingConfigVersion{}).
			Where("id = ? AND status = 'draft'", id).
			Updates(map[string]interface{}{
				"status":      "active",
				"approved_by": adminID,
				"approved_at": time.Now(),
			})

		if result.Error != nil {
			return result.Error
		}

		if result.RowsAffected == 0 {
			return fmt.Errorf("version not found or not in draft status")
		}

		return nil
	})

	if err != nil {
		return fmt.Errorf("failed to activate version: %w", err)
	}
	return nil
}

func (r *Repository) ArchiveVersion(ctx context.Context, id uuid.UUID) error {
	err := r.db.Primary.WithContext(ctx).Model(&PricingConfigVersion{}).
		Where("id = ?", id).
		Update("status", "archived").Error

	if err != nil {
		return fmt.Errorf("failed to archive version: %w", err)
	}
	return nil
}

func (r *Repository) CloneVersion(ctx context.Context, sourceID uuid.UUID, name string, adminID uuid.UUID) (*PricingConfigVersion, error) {
	newID := uuid.New()
	var v PricingConfigVersion

	err := r.db.Primary.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		query := `
			INSERT INTO pricing_config_versions (id, version_number, name, description, status, created_by, created_at, updated_at)
			SELECT ?, (SELECT COALESCE(MAX(version_number), 0) + 1 FROM pricing_config_versions),
			       ?, description, 'draft', ?, NOW(), NOW()
			FROM pricing_config_versions WHERE id = ?
			RETURNING *
		`
		if err := tx.Raw(query, newID, name, adminID, sourceID).Scan(&v).Error; err != nil {
			return err
		}

		if err := tx.Exec(`
			INSERT INTO pricing_configs (id, version_id, country_id, region_id, city_id, zone_id,
			       ride_type_id, base_fare, per_km_rate, per_minute_rate, minimum_fare, booking_fee,
			       platform_commission_pct, driver_incentive_pct, surge_min_multiplier, surge_max_multiplier,
			       tax_rate_pct, tax_inclusive, cancellation_fees, is_active, created_at, updated_at)
			SELECT gen_random_uuid(), ?, country_id, region_id, city_id, zone_id,
			       ride_type_id, base_fare, per_km_rate, per_minute_rate, minimum_fare, booking_fee,
			       platform_commission_pct, driver_incentive_pct, surge_min_multiplier, surge_max_multiplier,
			       tax_rate_pct, tax_inclusive, cancellation_fees, is_active, NOW(), NOW()
			FROM pricing_configs WHERE version_id = ?
		`, newID, sourceID).Error; err != nil {
			return err
		}

		if err := tx.Exec(`
			INSERT INTO time_multipliers (id, version_id, country_id, region_id, city_id,
			       name, days_of_week, start_time, end_time, multiplier, priority, is_active, created_at, updated_at)
			SELECT gen_random_uuid(), ?, country_id, region_id, city_id,
			       name, days_of_week, start_time, end_time, multiplier, priority, is_active, NOW(), NOW()
			FROM time_multipliers WHERE version_id = ?
		`, newID, sourceID).Error; err != nil {
			return err
		}

		if err := tx.Exec(`
			INSERT INTO weather_multipliers (id, version_id, country_id, region_id, city_id,
			       weather_condition, multiplier, is_active, created_at)
			SELECT gen_random_uuid(), ?, country_id, region_id, city_id,
			       weather_condition, multiplier, is_active, NOW()
			FROM weather_multipliers WHERE version_id = ?
		`, newID, sourceID).Error; err != nil {
			return err
		}

		if err := tx.Exec(`
			INSERT INTO event_multipliers (id, version_id, zone_id, city_id, event_name, event_type,
			       starts_at, ends_at, pre_event_minutes, post_event_minutes, multiplier,
			       expected_demand_increase, is_active, created_at)
			SELECT gen_random_uuid(), ?, zone_id, city_id, event_name, event_type,
			       starts_at, ends_at, pre_event_minutes, post_event_minutes, multiplier,
			       expected_demand_increase, is_active, NOW()
			FROM event_multipliers WHERE version_id = ?
		`, newID, sourceID).Error; err != nil {
			return err
		}

		if err := tx.Exec(`
			INSERT INTO zone_fees (id, zone_id, version_id, fee_type, ride_type_id, amount,
			       is_percentage, applies_pickup, applies_dropoff, schedule, is_active, created_at, updated_at)
			SELECT gen_random_uuid(), zone_id, ?, fee_type, ride_type_id, amount,
			       is_percentage, applies_pickup, applies_dropoff, schedule, is_active, NOW(), NOW()
			FROM zone_fees WHERE version_id = ?
		`, newID, sourceID).Error; err != nil {
			return err
		}

		if err := tx.Exec(`
			INSERT INTO surge_thresholds (id, version_id, country_id, region_id, city_id,
			       demand_supply_ratio_min, demand_supply_ratio_max, multiplier, is_active, created_at)
			SELECT gen_random_uuid(), ?, country_id, region_id, city_id,
			       demand_supply_ratio_min, demand_supply_ratio_max, multiplier, is_active, NOW()
			FROM surge_thresholds WHERE version_id = ?
		`, newID, sourceID).Error; err != nil {
			return err
		}

		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("failed to clone version: %w", err)
	}

	return &v, nil
}

func (r *Repository) CreateConfig(ctx context.Context, config *PricingConfig) error {
	if config.ID == uuid.Nil {
		config.ID = uuid.New()
	}

	err := r.db.Primary.WithContext(ctx).Create(config).Error
	if err != nil {
		return fmt.Errorf("failed to create config: %w", err)
	}
	return nil
}

func (r *Repository) GetConfigByID(ctx context.Context, id uuid.UUID) (*PricingConfig, error) {
	var config PricingConfig
	err := r.db.Primary.WithContext(ctx).First(&config, "id = ?", id).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get config: %w", err)
	}
	return &config, nil
}

func (r *Repository) ListConfigs(ctx context.Context, versionID uuid.UUID, limit, offset int) ([]*PricingConfig, int64, error) {
	var total int64
	var configs []*PricingConfig

	query := r.db.Primary.WithContext(ctx).Model(&PricingConfig{}).Where("version_id = ?", versionID)

	err := query.Count(&total).Error
	if err != nil {
		return nil, 0, fmt.Errorf("failed to count configs: %w", err)
	}

	err = query.Order(`CASE WHEN zone_id IS NOT NULL THEN 4 WHEN city_id IS NOT NULL THEN 3 WHEN region_id IS NOT NULL THEN 2 WHEN country_id IS NOT NULL THEN 1 ELSE 0 END, created_at DESC`).
		Limit(limit).Offset(offset).Find(&configs).Error

	if err != nil {
		return nil, 0, fmt.Errorf("failed to list configs: %w", err)
	}

	return configs, total, nil
}

func (r *Repository) UpdateConfig(ctx context.Context, config *PricingConfig) error {
	err := r.db.Primary.WithContext(ctx).Save(config).Error
	if err != nil {
		return fmt.Errorf("failed to update config: %w", err)
	}
	return nil
}

func (r *Repository) DeleteConfig(ctx context.Context, id uuid.UUID) error {
	err := r.db.Primary.WithContext(ctx).Delete(&PricingConfig{}, "id = ?", id).Error
	if err != nil {
		return fmt.Errorf("failed to delete config: %w", err)
	}
	return nil
}

func (r *Repository) CreateTimeMultiplier(ctx context.Context, m *TimeMultiplier) error {
	if m.ID == uuid.Nil {
		m.ID = uuid.New()
	}
	err := r.db.Primary.WithContext(ctx).Create(m).Error
	if err != nil {
		return fmt.Errorf("failed to create time multiplier: %w", err)
	}
	return nil
}

func (r *Repository) GetTimeMultiplierByID(ctx context.Context, id uuid.UUID) (*TimeMultiplier, error) {
	var m TimeMultiplier
	err := r.db.Primary.WithContext(ctx).First(&m, "id = ?", id).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get time multiplier: %w", err)
	}
	return &m, nil
}

func (r *Repository) ListTimeMultipliersByVersion(ctx context.Context, versionID uuid.UUID, limit, offset int) ([]*TimeMultiplier, int64, error) {
	var total int64
	var items []*TimeMultiplier

	query := r.db.Primary.WithContext(ctx).Model(&TimeMultiplier{}).Where("version_id = ?", versionID)
	err := query.Count(&total).Error
	if err != nil {
		return nil, 0, fmt.Errorf("failed to count time multipliers: %w", err)
	}

	err = query.Order("priority DESC, created_at DESC").Limit(limit).Offset(offset).Find(&items).Error
	if err != nil {
		return nil, 0, fmt.Errorf("failed to list time multipliers: %w", err)
	}

	return items, total, nil
}

func (r *Repository) UpdateTimeMultiplier(ctx context.Context, m *TimeMultiplier) error {
	err := r.db.Primary.WithContext(ctx).Save(m).Error
	if err != nil {
		return fmt.Errorf("failed to update time multiplier: %w", err)
	}
	return nil
}

func (r *Repository) DeleteTimeMultiplier(ctx context.Context, id uuid.UUID) error {
	err := r.db.Primary.WithContext(ctx).Delete(&TimeMultiplier{}, "id = ?", id).Error
	if err != nil {
		return fmt.Errorf("failed to delete time multiplier: %w", err)
	}
	return nil
}

func (r *Repository) CreateWeatherMultiplier(ctx context.Context, m *WeatherMultiplier) error {
	if m.ID == uuid.Nil {
		m.ID = uuid.New()
	}
	err := r.db.Primary.WithContext(ctx).Create(m).Error
	if err != nil {
		return fmt.Errorf("failed to create weather multiplier: %w", err)
	}
	return nil
}

func (r *Repository) GetWeatherMultiplierByID(ctx context.Context, id uuid.UUID) (*WeatherMultiplier, error) {
	var m WeatherMultiplier
	err := r.db.Primary.WithContext(ctx).First(&m, "id = ?", id).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get weather multiplier: %w", err)
	}
	return &m, nil
}

func (r *Repository) ListWeatherMultipliersByVersion(ctx context.Context, versionID uuid.UUID, limit, offset int) ([]*WeatherMultiplier, int64, error) {
	var total int64
	var items []*WeatherMultiplier
	query := r.db.Primary.WithContext(ctx).Model(&WeatherMultiplier{}).Where("version_id = ?", versionID)
	err := query.Count(&total).Error
	if err != nil {
		return nil, 0, fmt.Errorf("failed to count weather multipliers: %w", err)
	}
	err = query.Order("weather_condition").Limit(limit).Offset(offset).Find(&items).Error
	if err != nil {
		return nil, 0, fmt.Errorf("failed to list weather multipliers: %w", err)
	}
	return items, total, nil
}

func (r *Repository) UpdateWeatherMultiplier(ctx context.Context, m *WeatherMultiplier) error {
	err := r.db.Primary.WithContext(ctx).Save(m).Error
	if err != nil {
		return fmt.Errorf("failed to update weather multiplier: %w", err)
	}
	return nil
}

func (r *Repository) DeleteWeatherMultiplier(ctx context.Context, id uuid.UUID) error {
	err := r.db.Primary.WithContext(ctx).Delete(&WeatherMultiplier{}, "id = ?", id).Error
	if err != nil {
		return fmt.Errorf("failed to delete weather multiplier: %w", err)
	}
	return nil
}

func (r *Repository) CreateEventMultiplier(ctx context.Context, m *EventMultiplier) error {
	if m.ID == uuid.Nil {
		m.ID = uuid.New()
	}
	err := r.db.Primary.WithContext(ctx).Create(m).Error
	if err != nil {
		return fmt.Errorf("failed to create event multiplier: %w", err)
	}
	return nil
}

func (r *Repository) GetEventMultiplierByID(ctx context.Context, id uuid.UUID) (*EventMultiplier, error) {
	var m EventMultiplier
	err := r.db.Primary.WithContext(ctx).First(&m, "id = ?", id).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get event multiplier: %w", err)
	}
	return &m, nil
}

func (r *Repository) ListEventMultipliersByVersion(ctx context.Context, versionID uuid.UUID, limit, offset int) ([]*EventMultiplier, int64, error) {
	var total int64
	var items []*EventMultiplier
	query := r.db.Primary.WithContext(ctx).Model(&EventMultiplier{}).Where("version_id = ?", versionID)
	err := query.Count(&total).Error
	if err != nil {
		return nil, 0, fmt.Errorf("failed to count event multipliers: %w", err)
	}
	err = query.Order("starts_at DESC").Limit(limit).Offset(offset).Find(&items).Error
	if err != nil {
		return nil, 0, fmt.Errorf("failed to list event multipliers: %w", err)
	}
	return items, total, nil
}

func (r *Repository) UpdateEventMultiplier(ctx context.Context, m *EventMultiplier) error {
	err := r.db.Primary.WithContext(ctx).Save(m).Error
	if err != nil {
		return fmt.Errorf("failed to update event multiplier: %w", err)
	}
	return nil
}

func (r *Repository) DeleteEventMultiplier(ctx context.Context, id uuid.UUID) error {
	err := r.db.Primary.WithContext(ctx).Delete(&EventMultiplier{}, "id = ?", id).Error
	if err != nil {
		return fmt.Errorf("failed to delete event multiplier: %w", err)
	}
	return nil
}

func (r *Repository) CreateZoneFee(ctx context.Context, fee *ZoneFee) error {
	if fee.ID == uuid.Nil {
		fee.ID = uuid.New()
	}
	err := r.db.Primary.WithContext(ctx).Create(fee).Error
	if err != nil {
		return fmt.Errorf("failed to create zone fee: %w", err)
	}
	return nil
}

func (r *Repository) GetZoneFeeByID(ctx context.Context, id uuid.UUID) (*ZoneFee, error) {
	var fee ZoneFee
	err := r.db.Primary.WithContext(ctx).First(&fee, "id = ?", id).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get zone fee: %w", err)
	}
	return &fee, nil
}

func (r *Repository) ListZoneFeesByVersion(ctx context.Context, versionID uuid.UUID, zoneID *uuid.UUID, limit, offset int) ([]*ZoneFee, int64, error) {
	var total int64
	var items []*ZoneFee

	query := r.db.Primary.WithContext(ctx).Model(&ZoneFee{}).Where("version_id = ?", versionID)
	if zoneID != nil {
		query = query.Where("zone_id = ?", *zoneID)
	}

	err := query.Count(&total).Error
	if err != nil {
		return nil, 0, fmt.Errorf("failed to count zone fees: %w", err)
	}

	err = query.Order("fee_type").Limit(limit).Offset(offset).Find(&items).Error
	if err != nil {
		return nil, 0, fmt.Errorf("failed to list zone fees: %w", err)
	}

	return items, total, nil
}

func (r *Repository) UpdateZoneFee(ctx context.Context, fee *ZoneFee) error {
	err := r.db.Primary.WithContext(ctx).Save(fee).Error
	if err != nil {
		return fmt.Errorf("failed to update zone fee: %w", err)
	}
	return nil
}

func (r *Repository) DeleteZoneFee(ctx context.Context, id uuid.UUID) error {
	err := r.db.Primary.WithContext(ctx).Delete(&ZoneFee{}, "id = ?", id).Error
	if err != nil {
		return fmt.Errorf("failed to delete zone fee: %w", err)
	}
	return nil
}

func (r *Repository) CreateSurgeThreshold(ctx context.Context, t *SurgeThreshold) error {
	if t.ID == uuid.Nil {
		t.ID = uuid.New()
	}
	err := r.db.Primary.WithContext(ctx).Create(t).Error
	if err != nil {
		return fmt.Errorf("failed to create surge threshold: %w", err)
	}
	return nil
}

func (r *Repository) GetSurgeThresholdByID(ctx context.Context, id uuid.UUID) (*SurgeThreshold, error) {
	var t SurgeThreshold
	err := r.db.Primary.WithContext(ctx).First(&t, "id = ?", id).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get surge threshold: %w", err)
	}
	return &t, nil
}

func (r *Repository) ListSurgeThresholdsByVersion(ctx context.Context, versionID uuid.UUID, limit, offset int) ([]*SurgeThreshold, int64, error) {
	var total int64
	var items []*SurgeThreshold

	query := r.db.Primary.WithContext(ctx).Model(&SurgeThreshold{}).Where("version_id = ?", versionID)
	err := query.Count(&total).Error
	if err != nil {
		return nil, 0, fmt.Errorf("failed to count surge thresholds: %w", err)
	}

	err = query.Order("demand_supply_ratio_min").Limit(limit).Offset(offset).Find(&items).Error
	if err != nil {
		return nil, 0, fmt.Errorf("failed to list surge thresholds: %w", err)
	}

	return items, total, nil
}

func (r *Repository) UpdateSurgeThreshold(ctx context.Context, t *SurgeThreshold) error {
	err := r.db.Primary.WithContext(ctx).Save(t).Error
	if err != nil {
		return fmt.Errorf("failed to update surge threshold: %w", err)
	}
	return nil
}

func (r *Repository) DeleteSurgeThreshold(ctx context.Context, id uuid.UUID) error {
	err := r.db.Primary.WithContext(ctx).Delete(&SurgeThreshold{}, "id = ?", id).Error
	if err != nil {
		return fmt.Errorf("failed to delete surge threshold: %w", err)
	}
	return nil
}

func (r *Repository) InsertPricingAuditLog(ctx context.Context, adminID uuid.UUID, action, entityType string, entityID uuid.UUID, oldValues, newValues map[string]interface{}, reason string) {
	log := &PricingAuditLog{
		ID:         uuid.New(),
		AdminID:    adminID,
		Action:     action,
		EntityType: entityType,
		EntityID:   entityID,
		OldValues:  oldValues,
		NewValues:  newValues,
		Reason:     &reason,
	}
	if reason == "" {
		log.Reason = nil
	}

	err := r.db.Primary.WithContext(ctx).Create(log).Error
	if err != nil {
		fmt.Printf("WARN: failed to insert pricing audit log: %v\n", err)
	}
}

func (r *Repository) GetPricingAuditLogs(ctx context.Context, entityType string, entityID *uuid.UUID, limit, offset int) ([]*PricingAuditLog, int64, error) {
	var total int64
	var logs []*PricingAuditLog

	query := r.db.Primary.WithContext(ctx).Model(&PricingAuditLog{})
	if entityType != "" {
		query = query.Where("entity_type = ?", entityType)
	}
	if entityID != nil {
		query = query.Where("entity_id = ?", *entityID)
	}

	err := query.Count(&total).Error
	if err != nil {
		return nil, 0, fmt.Errorf("failed to count audit logs: %w", err)
	}

	err = query.Order("created_at DESC").Limit(limit).Offset(offset).Find(&logs).Error
	if err != nil {
		return nil, 0, fmt.Errorf("failed to get audit logs: %w", err)
	}

	return logs, total, nil
}
