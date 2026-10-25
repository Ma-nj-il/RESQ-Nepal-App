package scheduling

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"gorm.io/gorm"

	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

// Repository handles scheduling database operations
type Repository struct {
	db *gorm.DB
}

// NewRepository creates a new scheduling repository
func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

// ========================================
// RECURRING RIDE OPERATIONS
// ========================================

// CreateRecurringRide creates a new recurring ride
func (r *Repository) CreateRecurringRide(ctx context.Context, ride *RecurringRide) error {
	pickupJSON, _ := json.Marshal(ride.PickupLocation)
	dropoffJSON, _ := json.Marshal(ride.DropoffLocation)
	daysJSON, _ := json.Marshal(ride.DaysOfWeek)

	query := `
		INSERT INTO recurring_rides (
			id, rider_id, name,
			pickup_location, dropoff_location, pickup_address, dropoff_address,
			ride_type, notes,
			recurrence_pattern, days_of_week, scheduled_time, timezone,
			start_date, end_date, max_occurrences, occurrence_count,
			price_lock_enabled, locked_price, price_lock_expiry,
			preferred_driver_id, same_driver_enabled, last_driver_id,
			reminder_minutes, notify_on_booking, notify_on_cancel,
			status, last_scheduled_at, next_scheduled_at,
			corporate_account_id, cost_center,
			created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33)
	`

	_, err := r.sqlDB().ExecContext(ctx, query,
		ride.ID, ride.RiderID, ride.Name,
		pickupJSON, dropoffJSON, ride.PickupAddress, ride.DropoffAddress,
		ride.RideType, ride.Notes,
		ride.RecurrencePattern, daysJSON, ride.ScheduledTime, ride.Timezone,
		ride.StartDate, ride.EndDate, ride.MaxOccurrences, ride.OccurrenceCount,
		ride.PriceLockEnabled, ride.LockedPrice, ride.PriceLockExpiry,
		ride.PreferredDriverID, ride.SameDriverEnabled, ride.LastDriverID,
		ride.ReminderMinutes, ride.NotifyOnBooking, ride.NotifyOnCancel,
		ride.Status, ride.LastScheduledAt, ride.NextScheduledAt,
		ride.CorporateAccountID, ride.CostCenter,
		ride.CreatedAt, ride.UpdatedAt,
	)
	return err
}

// GetRecurringRide gets a recurring ride by ID
func (r *Repository) GetRecurringRide(ctx context.Context, rideID uuid.UUID) (*RecurringRide, error) {
	query := `
		SELECT id, rider_id, name,
			pickup_location, dropoff_location, pickup_address, dropoff_address,
			ride_type, notes,
			recurrence_pattern, days_of_week, scheduled_time, timezone,
			start_date, end_date, max_occurrences, occurrence_count,
			price_lock_enabled, locked_price, price_lock_expiry,
			preferred_driver_id, same_driver_enabled, last_driver_id,
			reminder_minutes, notify_on_booking, notify_on_cancel,
			status, last_scheduled_at, next_scheduled_at,
			corporate_account_id, cost_center,
			created_at, updated_at
		FROM recurring_rides
		WHERE id = $1
	`

	var ride RecurringRide
	var pickupJSON, dropoffJSON, daysJSON []byte
	err := r.sqlDB().QueryRowContext(ctx, query, rideID).Scan(
		&ride.ID, &ride.RiderID, &ride.Name,
		&pickupJSON, &dropoffJSON, &ride.PickupAddress, &ride.DropoffAddress,
		&ride.RideType, &ride.Notes,
		&ride.RecurrencePattern, &daysJSON, &ride.ScheduledTime, &ride.Timezone,
		&ride.StartDate, &ride.EndDate, &ride.MaxOccurrences, &ride.OccurrenceCount,
		&ride.PriceLockEnabled, &ride.LockedPrice, &ride.PriceLockExpiry,
		&ride.PreferredDriverID, &ride.SameDriverEnabled, &ride.LastDriverID,
		&ride.ReminderMinutes, &ride.NotifyOnBooking, &ride.NotifyOnCancel,
		&ride.Status, &ride.LastScheduledAt, &ride.NextScheduledAt,
		&ride.CorporateAccountID, &ride.CostCenter,
		&ride.CreatedAt, &ride.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	if err := json.Unmarshal(pickupJSON, &ride.PickupLocation); err != nil {
		logger.Warn("failed to unmarshal pickup location", zap.Error(err))
	}
	if err := json.Unmarshal(dropoffJSON, &ride.DropoffLocation); err != nil {
		logger.Warn("failed to unmarshal dropoff location", zap.Error(err))
	}
	if err := json.Unmarshal(daysJSON, &ride.DaysOfWeek); err != nil {
		logger.Warn("failed to unmarshal days of week", zap.Error(err))
	}

	return &ride, nil
}

// ListRecurringRidesForRider lists recurring rides for a rider
func (r *Repository) ListRecurringRidesForRider(ctx context.Context, riderID uuid.UUID) ([]*RecurringRide, error) {
	query := `
		SELECT id, rider_id, name,
			pickup_location, dropoff_location, pickup_address, dropoff_address,
			ride_type, notes,
			recurrence_pattern, days_of_week, scheduled_time, timezone,
			start_date, end_date, max_occurrences, occurrence_count,
			price_lock_enabled, locked_price, price_lock_expiry,
			preferred_driver_id, same_driver_enabled, last_driver_id,
			reminder_minutes, notify_on_booking, notify_on_cancel,
			status, last_scheduled_at, next_scheduled_at,
			corporate_account_id, cost_center,
			created_at, updated_at
		FROM recurring_rides
		WHERE rider_id = $1 AND status != 'cancelled'
		ORDER BY created_at DESC
	`

	rows, err := r.sqlDB().QueryContext(ctx, query, riderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rides []*RecurringRide
	for rows.Next() {
		var ride RecurringRide
		var pickupJSON, dropoffJSON, daysJSON []byte
		err := rows.Scan(
			&ride.ID, &ride.RiderID, &ride.Name,
			&pickupJSON, &dropoffJSON, &ride.PickupAddress, &ride.DropoffAddress,
			&ride.RideType, &ride.Notes,
			&ride.RecurrencePattern, &daysJSON, &ride.ScheduledTime, &ride.Timezone,
			&ride.StartDate, &ride.EndDate, &ride.MaxOccurrences, &ride.OccurrenceCount,
			&ride.PriceLockEnabled, &ride.LockedPrice, &ride.PriceLockExpiry,
			&ride.PreferredDriverID, &ride.SameDriverEnabled, &ride.LastDriverID,
			&ride.ReminderMinutes, &ride.NotifyOnBooking, &ride.NotifyOnCancel,
			&ride.Status, &ride.LastScheduledAt, &ride.NextScheduledAt,
			&ride.CorporateAccountID, &ride.CostCenter,
			&ride.CreatedAt, &ride.UpdatedAt,
		)
		if err != nil {
			continue
		}
		if err := json.Unmarshal(pickupJSON, &ride.PickupLocation); err != nil {
			logger.Warn("failed to unmarshal pickup location", zap.Error(err))
		}
		if err := json.Unmarshal(dropoffJSON, &ride.DropoffLocation); err != nil {
			logger.Warn("failed to unmarshal dropoff location", zap.Error(err))
		}
		if err := json.Unmarshal(daysJSON, &ride.DaysOfWeek); err != nil {
			logger.Warn("failed to unmarshal days of week", zap.Error(err))
		}
		rides = append(rides, &ride)
	}

	return rides, nil
}

// UpdateRecurringRideStatus updates the status of a recurring ride
func (r *Repository) UpdateRecurringRideStatus(ctx context.Context, rideID uuid.UUID, status ScheduleStatus) error {
	query := `UPDATE recurring_rides SET status = $1, updated_at = NOW() WHERE id = $2`
	_, err := r.sqlDB().ExecContext(ctx, query, status, rideID)
	return err
}

// UpdateRecurringRide updates a recurring ride
func (r *Repository) UpdateRecurringRide(ctx context.Context, ride *RecurringRide) error {
	daysJSON, _ := json.Marshal(ride.DaysOfWeek)

	query := `
		UPDATE recurring_rides SET
			name = $1, scheduled_time = $2, ride_type = $3, notes = $4,
			days_of_week = $5, end_date = $6,
			price_lock_enabled = $7, same_driver_enabled = $8,
			reminder_minutes = $9, status = $10,
			next_scheduled_at = $11, occurrence_count = $12,
			last_driver_id = $13, updated_at = NOW()
		WHERE id = $14
	`

	_, err := r.sqlDB().ExecContext(ctx, query,
		ride.Name, ride.ScheduledTime, ride.RideType, ride.Notes,
		daysJSON, ride.EndDate,
		ride.PriceLockEnabled, ride.SameDriverEnabled,
		ride.ReminderMinutes, ride.Status,
		ride.NextScheduledAt, ride.OccurrenceCount,
		ride.LastDriverID, ride.ID,
	)
	return err
}

// GetActiveRecurringRidesForScheduling gets rides that need scheduling
func (r *Repository) GetActiveRecurringRidesForScheduling(ctx context.Context) ([]*RecurringRide, error) {
	query := `
		SELECT id, rider_id, name,
			pickup_location, dropoff_location, pickup_address, dropoff_address,
			ride_type, notes,
			recurrence_pattern, days_of_week, scheduled_time, timezone,
			start_date, end_date, max_occurrences, occurrence_count,
			price_lock_enabled, locked_price, price_lock_expiry,
			preferred_driver_id, same_driver_enabled, last_driver_id,
			reminder_minutes, notify_on_booking, notify_on_cancel,
			status, last_scheduled_at, next_scheduled_at,
			corporate_account_id, cost_center,
			created_at, updated_at
		FROM recurring_rides
		WHERE status = 'active'
			AND (next_scheduled_at IS NULL OR next_scheduled_at <= NOW() + INTERVAL '24 hours')
			AND (end_date IS NULL OR end_date >= NOW())
			AND (max_occurrences IS NULL OR occurrence_count < max_occurrences)
		ORDER BY next_scheduled_at ASC NULLS FIRST
		LIMIT 100
	`

	rows, err := r.sqlDB().QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rides []*RecurringRide
	for rows.Next() {
		var ride RecurringRide
		var pickupJSON, dropoffJSON, daysJSON []byte
		err := rows.Scan(
			&ride.ID, &ride.RiderID, &ride.Name,
			&pickupJSON, &dropoffJSON, &ride.PickupAddress, &ride.DropoffAddress,
			&ride.RideType, &ride.Notes,
			&ride.RecurrencePattern, &daysJSON, &ride.ScheduledTime, &ride.Timezone,
			&ride.StartDate, &ride.EndDate, &ride.MaxOccurrences, &ride.OccurrenceCount,
			&ride.PriceLockEnabled, &ride.LockedPrice, &ride.PriceLockExpiry,
			&ride.PreferredDriverID, &ride.SameDriverEnabled, &ride.LastDriverID,
			&ride.ReminderMinutes, &ride.NotifyOnBooking, &ride.NotifyOnCancel,
			&ride.Status, &ride.LastScheduledAt, &ride.NextScheduledAt,
			&ride.CorporateAccountID, &ride.CostCenter,
			&ride.CreatedAt, &ride.UpdatedAt,
		)
		if err != nil {
			continue
		}
		if err := json.Unmarshal(pickupJSON, &ride.PickupLocation); err != nil {
			logger.Warn("failed to unmarshal pickup location", zap.Error(err))
		}
		if err := json.Unmarshal(dropoffJSON, &ride.DropoffLocation); err != nil {
			logger.Warn("failed to unmarshal dropoff location", zap.Error(err))
		}
		if err := json.Unmarshal(daysJSON, &ride.DaysOfWeek); err != nil {
			logger.Warn("failed to unmarshal days of week", zap.Error(err))
		}
		rides = append(rides, &ride)
	}

	return rides, nil
}

// ========================================
// INSTANCE OPERATIONS
// ========================================

// CreateInstance creates a new scheduled ride instance
func (r *Repository) CreateInstance(ctx context.Context, instance *ScheduledRideInstance) error {
	pickupJSON, _ := json.Marshal(instance.PickupLocation)
	dropoffJSON, _ := json.Marshal(instance.DropoffLocation)

	query := `
		INSERT INTO scheduled_ride_instances (
			id, recurring_ride_id, rider_id, ride_id,
			scheduled_date, scheduled_time, pickup_at,
			pickup_location, dropoff_location, pickup_address, dropoff_address,
			estimated_fare, actual_fare, price_locked,
			driver_id, driver_assigned_at,
			status, status_reason,
			reminder_sent_at, booked_at, completed_at,
			created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
	`

	_, err := r.sqlDB().ExecContext(ctx, query,
		instance.ID, instance.RecurringRideID, instance.RiderID, instance.RideID,
		instance.ScheduledDate, instance.ScheduledTime, instance.PickupAt,
		pickupJSON, dropoffJSON, instance.PickupAddress, instance.DropoffAddress,
		instance.EstimatedFare, instance.ActualFare, instance.PriceLocked,
		instance.DriverID, instance.DriverAssignedAt,
		instance.Status, instance.StatusReason,
		instance.ReminderSentAt, instance.BookedAt, instance.CompletedAt,
		instance.CreatedAt, instance.UpdatedAt,
	)
	return err
}

// GetInstance gets a scheduled ride instance by ID
func (r *Repository) GetInstance(ctx context.Context, instanceID uuid.UUID) (*ScheduledRideInstance, error) {
	query := `
		SELECT id, recurring_ride_id, rider_id, ride_id,
			scheduled_date, scheduled_time, pickup_at,
			pickup_location, dropoff_location, pickup_address, dropoff_address,
			estimated_fare, actual_fare, price_locked,
			driver_id, driver_assigned_at,
			status, status_reason,
			reminder_sent_at, booked_at, completed_at,
			created_at, updated_at
		FROM scheduled_ride_instances
		WHERE id = $1
	`

	var instance ScheduledRideInstance
	var pickupJSON, dropoffJSON []byte
	err := r.sqlDB().QueryRowContext(ctx, query, instanceID).Scan(
		&instance.ID, &instance.RecurringRideID, &instance.RiderID, &instance.RideID,
		&instance.ScheduledDate, &instance.ScheduledTime, &instance.PickupAt,
		&pickupJSON, &dropoffJSON, &instance.PickupAddress, &instance.DropoffAddress,
		&instance.EstimatedFare, &instance.ActualFare, &instance.PriceLocked,
		&instance.DriverID, &instance.DriverAssignedAt,
		&instance.Status, &instance.StatusReason,
		&instance.ReminderSentAt, &instance.BookedAt, &instance.CompletedAt,
		&instance.CreatedAt, &instance.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	if err := json.Unmarshal(pickupJSON, &instance.PickupLocation); err != nil {
		logger.Warn("failed to unmarshal pickup location", zap.Error(err))
	}
	if err := json.Unmarshal(dropoffJSON, &instance.DropoffLocation); err != nil {
		logger.Warn("failed to unmarshal dropoff location", zap.Error(err))
	}

	return &instance, nil
}

// GetUpcomingInstances gets upcoming instances for a recurring ride
func (r *Repository) GetUpcomingInstances(ctx context.Context, recurringRideID uuid.UUID, limit int) ([]*ScheduledRideInstance, error) {
	query := `
		SELECT id, recurring_ride_id, rider_id, ride_id,
			scheduled_date, scheduled_time, pickup_at,
			pickup_location, dropoff_location, pickup_address, dropoff_address,
			estimated_fare, actual_fare, price_locked,
			driver_id, driver_assigned_at,
			status, status_reason,
			reminder_sent_at, booked_at, completed_at,
			created_at, updated_at
		FROM scheduled_ride_instances
		WHERE recurring_ride_id = $1
			AND scheduled_date >= CURRENT_DATE
			AND status IN ('scheduled', 'confirmed')
		ORDER BY scheduled_date ASC, scheduled_time ASC
		LIMIT $2
	`

	rows, err := r.sqlDB().QueryContext(ctx, query, recurringRideID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var instances []*ScheduledRideInstance
	for rows.Next() {
		var instance ScheduledRideInstance
		var pickupJSON, dropoffJSON []byte
		err := rows.Scan(
			&instance.ID, &instance.RecurringRideID, &instance.RiderID, &instance.RideID,
			&instance.ScheduledDate, &instance.ScheduledTime, &instance.PickupAt,
			&pickupJSON, &dropoffJSON, &instance.PickupAddress, &instance.DropoffAddress,
			&instance.EstimatedFare, &instance.ActualFare, &instance.PriceLocked,
			&instance.DriverID, &instance.DriverAssignedAt,
			&instance.Status, &instance.StatusReason,
			&instance.ReminderSentAt, &instance.BookedAt, &instance.CompletedAt,
			&instance.CreatedAt, &instance.UpdatedAt,
		)
		if err != nil {
			continue
		}
		if err := json.Unmarshal(pickupJSON, &instance.PickupLocation); err != nil {
			logger.Warn("failed to unmarshal pickup location", zap.Error(err))
		}
		if err := json.Unmarshal(dropoffJSON, &instance.DropoffLocation); err != nil {
			logger.Warn("failed to unmarshal dropoff location", zap.Error(err))
		}
		instances = append(instances, &instance)
	}

	return instances, nil
}

// GetUpcomingInstancesForRider gets all upcoming instances for a rider
func (r *Repository) GetUpcomingInstancesForRider(ctx context.Context, riderID uuid.UUID, days int) ([]*ScheduledRideInstance, error) {
	query := `
		SELECT id, recurring_ride_id, rider_id, ride_id,
			scheduled_date, scheduled_time, pickup_at,
			pickup_location, dropoff_location, pickup_address, dropoff_address,
			estimated_fare, actual_fare, price_locked,
			driver_id, driver_assigned_at,
			status, status_reason,
			reminder_sent_at, booked_at, completed_at,
			created_at, updated_at
		FROM scheduled_ride_instances
		WHERE rider_id = $1
			AND scheduled_date >= CURRENT_DATE
			AND scheduled_date <= CURRENT_DATE + $2 * INTERVAL '1 day'
			AND status IN ('scheduled', 'confirmed')
		ORDER BY scheduled_date ASC, scheduled_time ASC
	`

	rows, err := r.sqlDB().QueryContext(ctx, query, riderID, days)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var instances []*ScheduledRideInstance
	for rows.Next() {
		var instance ScheduledRideInstance
		var pickupJSON, dropoffJSON []byte
		err := rows.Scan(
			&instance.ID, &instance.RecurringRideID, &instance.RiderID, &instance.RideID,
			&pickupJSON, &dropoffJSON, &instance.PickupAddress, &instance.DropoffAddress,
			&instance.EstimatedFare, &instance.ActualFare, &instance.PriceLocked,
			&instance.DriverID, &instance.DriverAssignedAt,
			&instance.Status, &instance.StatusReason,
			&instance.ReminderSentAt, &instance.BookedAt, &instance.CompletedAt,
			&instance.CreatedAt, &instance.UpdatedAt,
		)
		if err != nil {
			continue
		}
		if err := json.Unmarshal(pickupJSON, &instance.PickupLocation); err != nil {
			logger.Warn("failed to unmarshal pickup location", zap.Error(err))
		}
		if err := json.Unmarshal(dropoffJSON, &instance.DropoffLocation); err != nil {
			logger.Warn("failed to unmarshal dropoff location", zap.Error(err))
		}
		instances = append(instances, &instance)
	}

	return instances, nil
}

// UpdateInstanceStatus updates the status of an instance
func (r *Repository) UpdateInstanceStatus(ctx context.Context, instanceID uuid.UUID, status InstanceStatus, reason *string) error {
	query := `UPDATE scheduled_ride_instances SET status = $1, status_reason = $2, updated_at = NOW() WHERE id = $3`
	_, err := r.sqlDB().ExecContext(ctx, query, status, reason, instanceID)
	return err
}

// UpdateInstanceRide links an instance to an actual ride
func (r *Repository) UpdateInstanceRide(ctx context.Context, instanceID uuid.UUID, rideID uuid.UUID) error {
	query := `UPDATE scheduled_ride_instances SET ride_id = $1, booked_at = NOW(), status = 'confirmed', updated_at = NOW() WHERE id = $2`
	_, err := r.sqlDB().ExecContext(ctx, query, rideID, instanceID)
	return err
}

// UpdateInstanceDriver assigns a driver to an instance
func (r *Repository) UpdateInstanceDriver(ctx context.Context, instanceID uuid.UUID, driverID uuid.UUID) error {
	query := `UPDATE scheduled_ride_instances SET driver_id = $1, driver_assigned_at = NOW(), updated_at = NOW() WHERE id = $2`
	_, err := r.sqlDB().ExecContext(ctx, query, driverID, instanceID)
	return err
}

// MarkReminderSent marks a reminder as sent
func (r *Repository) MarkReminderSent(ctx context.Context, instanceID uuid.UUID) error {
	query := `UPDATE scheduled_ride_instances SET reminder_sent_at = NOW(), updated_at = NOW() WHERE id = $1`
	_, err := r.sqlDB().ExecContext(ctx, query, instanceID)
	return err
}

// GetInstancesNeedingReminders gets instances that need reminders
func (r *Repository) GetInstancesNeedingReminders(ctx context.Context) ([]*ScheduledRideInstance, error) {
	query := `
		SELECT sri.id, sri.recurring_ride_id, sri.rider_id, sri.ride_id,
			sri.scheduled_date, sri.scheduled_time, sri.pickup_at,
			sri.pickup_location, sri.dropoff_location, sri.pickup_address, sri.dropoff_address,
			sri.estimated_fare, sri.actual_fare, sri.price_locked,
			sri.driver_id, sri.driver_assigned_at,
			sri.status, sri.status_reason,
			sri.reminder_sent_at, sri.booked_at, sri.completed_at,
			sri.created_at, sri.updated_at
		FROM scheduled_ride_instances sri
		JOIN recurring_rides rr ON sri.recurring_ride_id = rr.id
		WHERE sri.status = 'scheduled'
			AND sri.reminder_sent_at IS NULL
			AND sri.pickup_at <= NOW() + rr.reminder_minutes * INTERVAL '1 minute'
			AND rr.reminder_minutes > 0
		ORDER BY sri.pickup_at ASC
		LIMIT 100
	`

	rows, err := r.sqlDB().QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var instances []*ScheduledRideInstance
	for rows.Next() {
		var instance ScheduledRideInstance
		var pickupJSON, dropoffJSON []byte
		err := rows.Scan(
			&instance.ID, &instance.RecurringRideID, &instance.RiderID, &instance.RideID,
			&instance.ScheduledDate, &instance.ScheduledTime, &instance.PickupAt,
			&pickupJSON, &dropoffJSON, &instance.PickupAddress, &instance.DropoffAddress,
			&instance.EstimatedFare, &instance.ActualFare, &instance.PriceLocked,
			&instance.DriverID, &instance.DriverAssignedAt,
			&instance.Status, &instance.StatusReason,
			&instance.ReminderSentAt, &instance.BookedAt, &instance.CompletedAt,
			&instance.CreatedAt, &instance.UpdatedAt,
		)
		if err != nil {
			continue
		}
		if err := json.Unmarshal(pickupJSON, &instance.PickupLocation); err != nil {
			logger.Warn("failed to unmarshal pickup location", zap.Error(err))
		}
		if err := json.Unmarshal(dropoffJSON, &instance.DropoffLocation); err != nil {
			logger.Warn("failed to unmarshal dropoff location", zap.Error(err))
		}
		instances = append(instances, &instance)
	}

	return instances, nil
}

// ========================================
// STATISTICS
// ========================================

// GetRiderStats gets statistics for a rider's recurring rides
func (r *Repository) GetRiderStats(ctx context.Context, riderID uuid.UUID) (*RecurringRideStats, error) {
	stats := &RecurringRideStats{}

	// Active schedules
	err := r.sqlDB().QueryRowContext(ctx, `
		SELECT COUNT(*) FROM recurring_rides WHERE rider_id = $1 AND status = 'active'
	`, riderID).Scan(&stats.ActiveSchedules)
	if err != nil {
		return nil, err
	}

	// Total rides booked
	err = r.sqlDB().QueryRowContext(ctx, `
		SELECT COUNT(*) FROM scheduled_ride_instances WHERE rider_id = $1
	`, riderID).Scan(&stats.TotalRidesBooked)
	if err != nil {
		return nil, err
	}

	// Completed rides
	err = r.sqlDB().QueryRowContext(ctx, `
		SELECT COUNT(*) FROM scheduled_ride_instances WHERE rider_id = $1 AND status = 'completed'
	`, riderID).Scan(&stats.CompletedRides)
	if err != nil {
		return nil, err
	}

	// Cancelled rides
	err = r.sqlDB().QueryRowContext(ctx, `
		SELECT COUNT(*) FROM scheduled_ride_instances WHERE rider_id = $1 AND status = 'cancelled'
	`, riderID).Scan(&stats.CancelledRides)
	if err != nil {
		return nil, err
	}

	// Total savings from price lock
	if err := r.sqlDB().QueryRowContext(ctx, `
		SELECT COALESCE(SUM(estimated_fare - COALESCE(actual_fare, estimated_fare)), 0)
		FROM scheduled_ride_instances
		WHERE rider_id = $1 AND price_locked = true AND status = 'completed'
	`, riderID).Scan(&stats.TotalSavings); err != nil {
		logger.Warn("failed to query total savings from price lock", zap.Error(err))
	}

	return stats, nil
}

// CheckExistingInstance checks if an instance already exists for a date
func (r *Repository) CheckExistingInstance(ctx context.Context, recurringRideID uuid.UUID, date time.Time) (bool, error) {
	var exists bool
	err := r.sqlDB().QueryRowContext(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM scheduled_ride_instances
			WHERE recurring_ride_id = $1 AND scheduled_date = $2
		)
	`, recurringRideID, date).Scan(&exists)
	return exists, err
}

// sqlDB returns the underlying *sql.DB from the gorm.DB instance.
func (r *Repository) sqlDB() *sql.DB {
	sqlDB, _ := r.db.DB()
	return sqlDB
}
