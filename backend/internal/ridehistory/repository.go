package ridehistory

import (
	"context"
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

func (r *Repository) queryHistory(ctx context.Context, query *gorm.DB, limit, offset int) ([]RideHistoryEntry, int, error) {
	var total int64
	var rides []RideHistoryEntry

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	err := query.Order("requested_at DESC").Limit(limit).Offset(offset).Find(&rides).Error
	if err != nil {
		return nil, 0, err
	}

	return rides, int(total), nil
}

// GetRiderHistory returns paginated ride history for a rider
func (r *Repository) GetRiderHistory(ctx context.Context, riderID uuid.UUID, filters *HistoryFilters, limit, offset int) ([]RideHistoryEntry, int, error) {
	query := r.db.Primary.WithContext(ctx).Model(&RideHistoryEntry{}).Where("rider_id = ?", riderID)
	query = applyFilters(query, filters)
	return r.queryHistory(ctx, query, limit, offset)
}

// GetDriverHistory returns paginated ride history for a driver
func (r *Repository) GetDriverHistory(ctx context.Context, driverID uuid.UUID, filters *HistoryFilters, limit, offset int) ([]RideHistoryEntry, int, error) {
	query := r.db.Primary.WithContext(ctx).Model(&RideHistoryEntry{}).Where("driver_id = ?", driverID)
	query = applyFilters(query, filters)
	return r.queryHistory(ctx, query, limit, offset)
}

func applyFilters(query *gorm.DB, filters *HistoryFilters) *gorm.DB {
	if filters != nil {
		if filters.Status != nil {
			query = query.Where("status = ?", *filters.Status)
		}
		if filters.FromDate != nil {
			query = query.Where("requested_at >= ?", *filters.FromDate)
		}
		if filters.ToDate != nil {
			query = query.Where("requested_at < ?", *filters.ToDate)
		}
		if filters.MinFare != nil {
			query = query.Where("COALESCE(final_fare, estimated_fare) >= ?", *filters.MinFare)
		}
		if filters.MaxFare != nil {
			query = query.Where("COALESCE(final_fare, estimated_fare) <= ?", *filters.MaxFare)
		}
	}
	return query
}

// GetRideByID returns a single ride by ID
func (r *Repository) GetRideByID(ctx context.Context, rideID uuid.UUID) (*RideHistoryEntry, error) {
	var ride RideHistoryEntry
	err := r.db.Primary.WithContext(ctx).First(&ride, "id = ?", rideID).Error
	if err != nil {
		return nil, err
	}
	return &ride, nil
}

// GetRiderStats returns aggregated stats for a rider
func (r *Repository) GetRiderStats(ctx context.Context, riderID uuid.UUID, from, to time.Time) (*RideStats, error) {
	var result struct {
		TotalRides      int
		CompletedRides  int
		CancelledRides  int
		TotalSpent      float64
		TotalDistance   float64
		TotalDuration   int
		AverageFare     float64
		AverageDistance float64
		AverageRating   float64
	}

	err := r.db.Primary.WithContext(ctx).Table("rides").
		Select(`
			COUNT(*) as total_rides,
			COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_rides,
			COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_rides,
			COALESCE(SUM(CASE WHEN status = 'completed' THEN COALESCE(final_fare, estimated_fare) ELSE 0 END), 0) as total_spent,
			COALESCE(SUM(CASE WHEN status = 'completed' THEN COALESCE(distance, estimated_distance) ELSE 0 END), 0) as total_distance,
			COALESCE(SUM(CASE WHEN status = 'completed' THEN COALESCE(duration, estimated_duration) ELSE 0 END), 0) as total_duration,
			COALESCE(AVG(CASE WHEN status = 'completed' THEN COALESCE(final_fare, estimated_fare) END), 0) as average_fare,
			COALESCE(AVG(CASE WHEN status = 'completed' THEN COALESCE(distance, estimated_distance) END), 0) as average_distance,
			COALESCE(AVG(rating), 0) as average_rating
		`).
		Where("rider_id = ? AND requested_at >= ? AND requested_at < ?", riderID, from, to).
		Scan(&result).Error

	if err != nil {
		return nil, err
	}

	return &RideStats{
		TotalRides:      result.TotalRides,
		CompletedRides:  result.CompletedRides,
		CancelledRides:  result.CancelledRides,
		TotalSpent:      result.TotalSpent,
		TotalDistance:   result.TotalDistance,
		TotalDuration:   result.TotalDuration,
		AverageFare:     result.AverageFare,
		AverageDistance: result.AverageDistance,
		AverageRating:   result.AverageRating,
		Currency:        "USD",
	}, nil
}

// GetFrequentRoutes returns commonly taken routes
func (r *Repository) GetFrequentRoutes(ctx context.Context, riderID uuid.UUID, limit int) ([]FrequentRoute, error) {
	var routes []FrequentRoute
	err := r.db.Primary.WithContext(ctx).Table("rides").
		Select(`
			pickup_address, dropoff_address,
			COUNT(*) as ride_count,
			AVG(COALESCE(final_fare, estimated_fare)) as average_fare,
			MAX(requested_at)::text as last_ride_at
		`).
		Where("rider_id = ? AND status = 'completed'", riderID).
		Group("pickup_address, dropoff_address").
		Having("COUNT(*) >= 2").
		Order("ride_count DESC").
		Limit(limit).
		Scan(&routes).Error

	return routes, err
}
