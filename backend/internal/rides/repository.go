package rides

import (
	"context"
	"fmt"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/database"
	"github.com/bikky-kc013/medi-ambulance/pkg/models"
	"github.com/google/uuid"
)

type Repository struct {
	db *database.DBPool
}

func NewRepository(db *database.DBPool) *Repository {
	return &Repository{db: db}
}

func (r *Repository) CreateRide(ctx context.Context, ride *models.Ride) error {
	if err := r.db.Primary.WithContext(ctx).Create(ride).Error; err != nil {
		return fmt.Errorf("failed to create ride: %w", err)
	}
	return nil
}

func (r *Repository) GetRideByID(ctx context.Context, id uuid.UUID) (*models.Ride, error) {
	var ride models.Ride
	err := r.db.Primary.WithContext(ctx).First(&ride, "id = ?", id).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get ride: %w", err)
	}

	return &ride, nil
}

func (r *Repository) UpdateRideStatus(ctx context.Context, id uuid.UUID, status models.RideStatus, driverID *uuid.UUID) error {
	updates := map[string]interface{}{
		"status":     status,
		"updated_at": time.Now(),
	}

	switch status {
	case models.RideStatusAccepted:
		updates["driver_id"] = driverID
		updates["accepted_at"] = time.Now()
	case models.RideStatusInProgress:
		updates["started_at"] = time.Now()
	case models.RideStatusCompleted:
		updates["completed_at"] = time.Now()
	case models.RideStatusCancelled:
		updates["cancelled_at"] = time.Now()
	}

	err := r.db.Primary.WithContext(ctx).Model(&models.Ride{}).Where("id = ?", id).Updates(updates).Error
	if err != nil {
		return fmt.Errorf("failed to update ride status: %w", err)
	}

	return nil
}

func (r *Repository) AtomicAcceptRide(ctx context.Context, rideID, driverID uuid.UUID) (bool, error) {
	now := time.Now()
	result := r.db.Primary.WithContext(ctx).Model(&models.Ride{}).
		Where("id = ? AND status = ?", rideID, models.RideStatusRequested).
		Updates(map[string]interface{}{
			"status":      models.RideStatusAccepted,
			"driver_id":   driverID,
			"accepted_at": now,
			"updated_at":  now,
		})

	if result.Error != nil {
		return false, fmt.Errorf("failed to accept ride: %w", result.Error)
	}
	return result.RowsAffected == 1, nil
}

// UpdateRideCompletion updates ride with actual data upon completion
func (r *Repository) UpdateRideCompletion(ctx context.Context, id uuid.UUID, actualDistance float64, actualDuration int, finalFare float64) error {
	err := r.db.Primary.WithContext(ctx).Model(&models.Ride{}).Where("id = ?", id).
		Updates(map[string]interface{}{
			"actual_distance": actualDistance,
			"actual_duration": actualDuration,
			"final_fare":      finalFare,
			"updated_at":      time.Now(),
		}).Error

	if err != nil {
		return fmt.Errorf("failed to update ride completion: %w", err)
	}

	return nil
}

// AtomicCompleteRide atomically sets completion data and status in a single UPDATE
// with a status+driver guard. Returns false if the ride was not in_progress or
// the driver doesn't match (prevents inconsistent state on partial failure).
func (r *Repository) AtomicCompleteRide(ctx context.Context, rideID, driverID uuid.UUID, actualDistance float64, actualDuration int, finalFare float64) (bool, error) {
	now := time.Now()
	result := r.db.Primary.WithContext(ctx).Model(&models.Ride{}).
		Where("id = ? AND status = ? AND driver_id = ?", rideID, models.RideStatusInProgress, driverID).
		Updates(map[string]interface{}{
			"status":          models.RideStatusCompleted,
			"actual_distance": actualDistance,
			"actual_duration": actualDuration,
			"final_fare":      finalFare,
			"completed_at":    now,
			"updated_at":      now,
		})

	if result.Error != nil {
		return false, fmt.Errorf("failed to complete ride: %w", result.Error)
	}
	return result.RowsAffected == 1, nil
}

// UpdateRideRating updates ride rating and feedback
func (r *Repository) UpdateRideRating(ctx context.Context, id uuid.UUID, rating int, feedback *string) error {
	err := r.db.Primary.WithContext(ctx).Model(&models.Ride{}).Where("id = ?", id).
		Updates(map[string]interface{}{
			"rating":     rating,
			"feedback":   feedback,
			"updated_at": time.Now(),
		}).Error

	if err != nil {
		return fmt.Errorf("failed to update ride rating: %w", err)
	}

	return nil
}

// GetRidesByRider retrieves rides for a specific rider
func (r *Repository) GetRidesByRider(ctx context.Context, riderID uuid.UUID, limit, offset int) ([]*models.Ride, error) {
	var rides []*models.Ride
	err := r.db.Primary.WithContext(ctx).
		Where("rider_id = ?", riderID).
		Order("created_at DESC").
		Limit(limit).
		Offset(offset).
		Find(&rides).Error

	if err != nil {
		return nil, fmt.Errorf("failed to get rides: %w", err)
	}

	return rides, nil
}

// GetRidesByDriver retrieves rides for a specific driver
func (r *Repository) GetRidesByDriver(ctx context.Context, driverID uuid.UUID, limit, offset int) ([]*models.Ride, error) {
	var rides []*models.Ride
	err := r.db.Primary.WithContext(ctx).
		Where("driver_id = ?", driverID).
		Order("created_at DESC").
		Limit(limit).
		Offset(offset).
		Find(&rides).Error

	if err != nil {
		return nil, fmt.Errorf("failed to get rides by driver: %w", err)
	}

	return rides, nil
}

func (r *Repository) GetRidesByRiderWithTotal(ctx context.Context, riderID uuid.UUID, limit, offset int) ([]*models.Ride, int64, error) {
	var total int64
	err := r.db.Primary.WithContext(ctx).Model(&models.Ride{}).Where("rider_id = ?", riderID).Count(&total).Error
	if err != nil {
		return nil, 0, fmt.Errorf("failed to count rides: %w", err)
	}

	rides, err := r.GetRidesByRider(ctx, riderID, limit, offset)
	if err != nil {
		return nil, 0, err
	}

	return rides, total, nil
}

// GetRidesByDriverWithTotal retrieves rides for a specific driver with total count
func (r *Repository) GetRidesByDriverWithTotal(ctx context.Context, driverID uuid.UUID, limit, offset int) ([]*models.Ride, int64, error) {
	var total int64
	err := r.db.Primary.WithContext(ctx).Model(&models.Ride{}).Where("driver_id = ?", driverID).Count(&total).Error
	if err != nil {
		return nil, 0, fmt.Errorf("failed to count rides by driver: %w", err)
	}

	rides, err := r.GetRidesByDriver(ctx, driverID, limit, offset)
	if err != nil {
		return nil, 0, err
	}

	return rides, total, nil
}

func (r *Repository) GetPendingRides(ctx context.Context) ([]models.Ride, error) {
	var rides []models.Ride
	err := r.db.Primary.WithContext(ctx).
		Where("status = ?", models.RideStatusRequested).
		Order("requested_at ASC").
		Find(&rides).Error

	if err != nil {
		return nil, fmt.Errorf("failed to get pending rides: %w", err)
	}

	return rides, nil
}

// RideFilters represents filters for ride history queries
type RideFilters struct {
	Status    *string
	StartDate *time.Time
	EndDate   *time.Time
}

// GetRidesByRiderWithFilters retrieves filtered rides for a rider
func (r *Repository) GetRidesByRiderWithFilters(ctx context.Context, riderID uuid.UUID, filters *RideFilters, limit, offset int) ([]*models.Ride, int, error) {
	query := r.db.Primary.WithContext(ctx).Model(&models.Ride{}).Where("rider_id = ?", riderID)

	if filters.Status != nil {
		query = query.Where("status = ?", *filters.Status)
	}

	if filters.StartDate != nil {
		query = query.Where("created_at >= ?", *filters.StartDate)
	}

	if filters.EndDate != nil {
		query = query.Where("created_at <= ?", *filters.EndDate)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to get total count: %w", err)
	}

	var rides []*models.Ride
	err := query.Order("created_at DESC").Limit(limit).Offset(offset).Find(&rides).Error
	if err != nil {
		return nil, 0, fmt.Errorf("failed to get filtered rides: %w", err)
	}

	return rides, int(total), nil
}

// GetUserProfile retrieves a user's profile information
func (r *Repository) GetUserProfile(ctx context.Context, userID uuid.UUID) (*models.User, error) {
	var user models.User
	err := r.db.Primary.WithContext(ctx).First(&user, "id = ?", userID).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get user profile: %w", err)
	}

	return &user, nil
}

// UpdateUserProfile updates a user's profile information
func (r *Repository) UpdateUserProfile(ctx context.Context, userID uuid.UUID, firstName, lastName, phoneNumber string) error {
	result := r.db.Primary.WithContext(ctx).Model(&models.User{}).Where("id = ?", userID).
		Updates(map[string]interface{}{
			"first_name":   firstName,
			"last_name":    lastName,
			"phone_number": phoneNumber,
			"updated_at":   time.Now(),
		})

	if result.Error != nil {
		return fmt.Errorf("failed to update user profile: %w", result.Error)
	}

	if result.RowsAffected == 0 {
		return fmt.Errorf("user not found")
	}

	return nil
}

// DriverMatchStats holds aggregated stats used by the matching algorithm.
type DriverMatchStats struct {
	DriverID       uuid.UUID
	Rating         float64
	AcceptanceRate float64
	IdleMinutes    float64
}

// GetDriverMatchStats returns acceptance rate and idle time for a list of driver IDs.
func (r *Repository) GetDriverMatchStats(ctx context.Context, driverIDs []uuid.UUID) (map[uuid.UUID]*DriverMatchStats, error) {
	if len(driverIDs) == 0 {
		return make(map[uuid.UUID]*DriverMatchStats), nil
	}

	query := `
		SELECT
			u.id,
			COALESCE(u.rating, 4.0) AS rating,
			COALESCE(
				CAST(SUM(CASE WHEN r.status IN ('accepted','started','completed') THEN 1 ELSE 0 END) AS FLOAT) /
				NULLIF(COUNT(r.id), 0),
				0.8
			) AS acceptance_rate,
			COALESCE(
				EXTRACT(EPOCH FROM (NOW() - MAX(r.completed_at))) / 60.0,
				30.0
			) AS idle_minutes
		FROM users u
		LEFT JOIN rides r ON r.driver_id = u.id AND r.created_at > NOW() - INTERVAL '30 days'
		WHERE u.id IN (?)
		GROUP BY u.id, u.rating
	`

	var results []struct {
		ID             uuid.UUID
		Rating         float64
		AcceptanceRate float64
		IdleMinutes    float64
	}

	err := r.db.Primary.WithContext(ctx).Raw(query, driverIDs).Scan(&results).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get driver match stats: %w", err)
	}

	stats := make(map[uuid.UUID]*DriverMatchStats, len(driverIDs))
	for _, res := range results {
		stats[res.ID] = &DriverMatchStats{
			DriverID:       res.ID,
			Rating:         res.Rating,
			AcceptanceRate: res.AcceptanceRate,
			IdleMinutes:    res.IdleMinutes,
		}
	}

	// Fill in defaults for drivers not in DB (new drivers)
	for _, id := range driverIDs {
		if _, ok := stats[id]; !ok {
			stats[id] = &DriverMatchStats{
				DriverID:       id,
				Rating:         4.0,
				AcceptanceRate: 0.8,
				IdleMinutes:    30.0,
			}
		}
	}

	return stats, nil
}

// GetPaymentByRideID retrieves payment information for a ride
func (r *Repository) GetPaymentByRideID(ctx context.Context, rideID uuid.UUID) (string, error) {
	var method string
	err := r.db.Primary.WithContext(ctx).Table("payments").Select("method").Where("ride_id = ?", rideID).Limit(1).Scan(&method).Error
	if err != nil {
		return "", fmt.Errorf("failed to get payment method: %w", err)
	}

	return method, nil
}
