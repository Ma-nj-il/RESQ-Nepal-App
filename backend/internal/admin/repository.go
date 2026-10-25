package admin

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

func (r *Repository) GetAuditLogs(ctx context.Context, limit, offset int, filter *AuditLogFilter) ([]*AuditLog, int64, error) {
	query := r.db.Primary.WithContext(ctx).Model(&AuditLog{}).
		Select("audit_logs.*, COALESCE(users.first_name || ' ' || users.last_name, '') as admin_name").
		Joins("LEFT JOIN users ON audit_logs.admin_id = users.id")

	if filter != nil {
		if filter.AdminID != nil {
			query = query.Where("audit_logs.admin_id = ?", *filter.AdminID)
		}
		if filter.Action != "" {
			query = query.Where("audit_logs.action = ?", filter.Action)
		}
		if filter.TargetType != "" {
			query = query.Where("audit_logs.target_type = ?", filter.TargetType)
		}
		if filter.TargetID != nil {
			query = query.Where("audit_logs.target_id = ?", *filter.TargetID)
		}
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to count audit logs: %w", err)
	}

	var logs []*AuditLog
	err := query.Order("audit_logs.created_at DESC").Limit(limit).Offset(offset).Find(&logs).Error
	if err != nil {
		return nil, 0, fmt.Errorf("failed to get audit logs: %w", err)
	}

	return logs, total, nil
}

func (r *Repository) InsertAuditLog(ctx context.Context, adminID uuid.UUID, action, targetType string, targetID uuid.UUID, metadata map[string]interface{}) {
	log := &AuditLog{
		ID:         uuid.New(),
		AdminID:    adminID,
		Action:     action,
		TargetType: targetType,
		TargetID:   targetID,
		Metadata:   metadata,
		CreatedAt:  time.Now(),
	}

	if err := r.db.Primary.WithContext(ctx).Create(log).Error; err != nil {
		fmt.Printf("WARN: failed to insert audit log: %v\n", err)
	}
}

func (r *Repository) GetAllUsers(ctx context.Context, limit, offset int, filter *UserFilter) ([]*models.User, int, error) {
	query := r.db.Primary.WithContext(ctx).Model(&models.User{})

	if filter != nil {
		if filter.Role != "" {
			query = query.Where("role = ?", filter.Role)
		}
		if filter.IsActive != nil {
			query = query.Where("is_active = ?", *filter.IsActive)
		}
		if filter.Search != "" {
			s := "%" + filter.Search + "%"
			query = query.Where("email ILIKE ? OR first_name ILIKE ? OR last_name ILIKE ? OR phone_number ILIKE ? OR CONCAT(first_name, ' ', last_name) ILIKE ?", s, s, s, s, s)
		}
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to get user count: %w", err)
	}

	var users []*models.User
	err := query.Order("created_at DESC").Limit(limit).Offset(offset).Find(&users).Error
	if err != nil {
		return nil, 0, fmt.Errorf("failed to get users: %w", err)
	}

	return users, int(total), nil
}

func (r *Repository) GetUserByID(ctx context.Context, id uuid.UUID) (*models.User, error) {
	var user models.User
	err := r.db.Primary.WithContext(ctx).First(&user, "id = ?", id).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get user: %w", err)
	}

	return &user, nil
}

func (r *Repository) UpdateUserStatus(ctx context.Context, id uuid.UUID, isActive bool) error {
	result := r.db.Primary.WithContext(ctx).Model(&models.User{}).Where("id = ?", id).Updates(map[string]interface{}{
		"is_active":  isActive,
		"updated_at": time.Now(),
	})
	if result.Error != nil {
		return fmt.Errorf("failed to update user status: %w", result.Error)
	}

	if result.RowsAffected == 0 {
		return fmt.Errorf("user not found")
	}

	return nil
}

func (r *Repository) GetDriverStats(ctx context.Context) (*DriverStats, error) {
	var stats DriverStats
	err := r.db.Primary.WithContext(ctx).Model(&models.Driver{}).
		Select(`
			COUNT(*) as total_drivers,
			COUNT(CASE WHEN is_online = true AND approval_status = 'approved' THEN 1 END) as online_drivers,
			COUNT(CASE WHEN is_online = false AND approval_status = 'approved' THEN 1 END) as offline_drivers,
			COUNT(CASE WHEN is_available = true AND is_online = true AND approval_status = 'approved' THEN 1 END) as available_drivers,
			COUNT(CASE WHEN approval_status = 'pending' THEN 1 END) as pending_approvals
		`).Scan(&stats).Error

	if err != nil {
		return nil, fmt.Errorf("failed to get driver stats: %w", err)
	}

	return &stats, nil
}

func (r *Repository) GetAllDriversWithTotal(ctx context.Context, limit, offset int, filter *DriverFilter) ([]*models.Driver, int64, error) {
	query := r.db.Primary.WithContext(ctx).Model(&models.Driver{}).
		Joins("JOIN users ON drivers.user_id = users.id")

	if filter != nil {
		switch filter.Status {
		case "online":
			query = query.Where("drivers.is_online = true AND drivers.approval_status = 'approved'")
		case "offline":
			query = query.Where("drivers.is_online = false AND drivers.approval_status = 'approved'")
		case "available":
			query = query.Where("drivers.is_available = true AND drivers.is_online = true AND drivers.approval_status = 'approved'")
		case "pending":
			query = query.Where("drivers.approval_status = 'pending'")
		}

		if filter.Search != "" {
			s := "%" + filter.Search + "%"
			query = query.Where(`(
				drivers.license_number ILIKE ? OR
				drivers.vehicle_model ILIKE ? OR
				drivers.vehicle_plate ILIKE ? OR
				drivers.vehicle_color ILIKE ? OR
				users.first_name ILIKE ? OR
				users.last_name ILIKE ? OR
				users.phone_number ILIKE ? OR
				CONCAT(users.first_name, ' ', users.last_name) ILIKE ?
			)`, s, s, s, s, s, s, s, s)
		}
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to count drivers: %w", err)
	}

	var drivers []*models.Driver
	err := query.Order("drivers.created_at DESC").Limit(limit).Offset(offset).Find(&drivers).Error
	if err != nil {
		return nil, 0, fmt.Errorf("failed to get drivers: %w", err)
	}

	return drivers, total, nil
}

func (r *Repository) GetPendingDrivers(ctx context.Context) ([]*models.Driver, error) {
	var drivers []*models.Driver
	err := r.db.Primary.WithContext(ctx).
		Where("approval_status = ?", "pending").
		Order("created_at DESC").
		Limit(100).
		Find(&drivers).Error

	if err != nil {
		return nil, fmt.Errorf("failed to get pending drivers: %w", err)
	}

	return drivers, nil
}

func (r *Repository) GetPendingDriversWithTotal(ctx context.Context, limit, offset int) ([]*models.Driver, int64, error) {
	var total int64
	if err := r.db.Primary.WithContext(ctx).Model(&models.Driver{}).Where("approval_status = ?", "pending").Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to count pending drivers: %w", err)
	}

	var drivers []*models.Driver
	err := r.db.Primary.WithContext(ctx).
		Where("approval_status = ?", "pending").
		Order("created_at DESC").
		Limit(limit).
		Offset(offset).
		Find(&drivers).Error

	if err != nil {
		return nil, 0, fmt.Errorf("failed to get drivers: %w", err)
	}

	return drivers, total, nil
}

func (r *Repository) GetDriverByID(ctx context.Context, driverID uuid.UUID) (*models.Driver, error) {
	var driver models.Driver
	err := r.db.Primary.WithContext(ctx).First(&driver, "id = ?", driverID).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get driver: %w", err)
	}

	return &driver, nil
}

func (r *Repository) ApproveDriver(ctx context.Context, driverID uuid.UUID) error {
	now := time.Now()
	result := r.db.Primary.WithContext(ctx).Model(&models.Driver{}).Where("id = ?", driverID).Updates(map[string]interface{}{
		"approval_status": "approved",
		"approved_at":     now,
		"updated_at":      now,
	})
	if result.Error != nil {
		return fmt.Errorf("failed to approve driver: %w", result.Error)
	}

	if result.RowsAffected == 0 {
		return fmt.Errorf("driver not found")
	}

	return nil
}

func (r *Repository) RejectDriver(ctx context.Context, driverID uuid.UUID) error {
	now := time.Now()
	result := r.db.Primary.WithContext(ctx).Model(&models.Driver{}).Where("id = ?", driverID).Updates(map[string]interface{}{
		"approval_status": "rejected",
		"rejected_at":     now,
		"updated_at":      now,
	})
	if result.Error != nil {
		return fmt.Errorf("failed to reject driver: %w", result.Error)
	}

	if result.RowsAffected == 0 {
		return fmt.Errorf("driver not found")
	}

	return nil
}

func (r *Repository) GetRideStats(ctx context.Context, startDate, endDate *time.Time) (*RideStats, error) {
	var stats RideStats
	query := r.db.Primary.WithContext(ctx).Table("rides")

	if startDate != nil {
		query = query.Where("created_at >= ?", *startDate)
	}
	if endDate != nil {
		query = query.Where("created_at <= ?", *endDate)
	}

	err := query.Select(`
		COUNT(*) as total_rides,
		COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_rides,
		COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_rides,
		COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as active_rides,
		COALESCE(SUM(CASE WHEN status = 'completed' THEN final_fare ELSE 0 END), 0) as total_revenue,
		COALESCE(AVG(CASE WHEN status = 'completed' THEN final_fare ELSE NULL END), 0) as avg_fare
	`).Scan(&stats).Error

	if err != nil {
		return nil, fmt.Errorf("failed to get ride stats: %w", err)
	}

	return &stats, nil
}

func (r *Repository) GetUserStats(ctx context.Context) (*UserStats, error) {
	var stats UserStats
	err := r.db.Primary.WithContext(ctx).Table("users").
		Select(`
			COUNT(*) as total_users,
			COUNT(CASE WHEN role = 'rider' THEN 1 END) as total_riders,
			COUNT(CASE WHEN role = 'driver' THEN 1 END) as total_drivers,
			COUNT(CASE WHEN role = 'admin' THEN 1 END) as total_admins,
			COUNT(CASE WHEN is_active = true THEN 1 END) as active_users
		`).
		Scan(&stats).Error

	if err != nil {
		return nil, fmt.Errorf("failed to get user stats: %w", err)
	}

	return &stats, nil
}

func (r *Repository) GetRecentRides(ctx context.Context, limit int) ([]*models.Ride, error) {
	var rides []*models.Ride
	err := r.db.Primary.WithContext(ctx).
		Order("created_at DESC").
		Limit(limit).
		Find(&rides).Error

	if err != nil {
		return nil, fmt.Errorf("failed to get recent rides: %w", err)
	}

	return rides, nil
}

func (r *Repository) GetRecentRidesWithTotal(ctx context.Context, limit, offset int) ([]*models.Ride, int64, error) {
	var total int64
	if err := r.db.Primary.WithContext(ctx).Model(&models.Ride{}).Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to count rides: %w", err)
	}

	var rides []*models.Ride
	err := r.db.Primary.WithContext(ctx).
		Order("created_at DESC").
		Limit(limit).
		Offset(offset).
		Find(&rides).Error

	if err != nil {
		return nil, 0, fmt.Errorf("failed to get recent rides: %w", err)
	}

	return rides, total, nil
}

func (r *Repository) GetRideByID(ctx context.Context, rideID uuid.UUID) (*AdminRideDetail, error) {
	var detail struct {
		models.Ride
		RiderEmail       string
		RiderFirstName   string
		RiderLastName    string
		RiderPhoneNumber string
		DriverID         *uuid.UUID
		DriverUserID     *uuid.UUID
		DriverFirstName  *string
		DriverLastName   *string
		DriverPhone      *string
		VehicleModel     *string
		VehiclePlate     *string
		VehicleColor     *string
		DriverRating     *float64
	}

	err := r.db.Primary.WithContext(ctx).Table("rides r").
		Select(`
			r.*,
			ru.email as rider_email, ru.first_name as rider_first_name, ru.last_name as rider_last_name, ru.phone_number as rider_phone_number,
			d.id as driver_id, d.user_id as driver_user_id, du.first_name as driver_first_name, du.last_name as driver_last_name, du.phone_number as driver_phone,
			d.vehicle_model, d.vehicle_plate, d.vehicle_color, d.rating as driver_rating
		`).
		Joins("JOIN users ru ON r.rider_id = ru.id").
		Joins("LEFT JOIN drivers d ON r.driver_id = d.id OR r.driver_id = d.user_id").
		Joins("LEFT JOIN users du ON d.user_id = du.id").
		Where("r.id = ?", rideID).
		Scan(&detail).Error

	if err != nil {
		return nil, fmt.Errorf("failed to get ride: %w", err)
	}

	result := &AdminRideDetail{
		Ride: &detail.Ride,
		Rider: &RideUserInfo{
			ID:          detail.RiderID,
			Email:       detail.RiderEmail,
			FirstName:   detail.RiderFirstName,
			LastName:    detail.RiderLastName,
			PhoneNumber: detail.RiderPhoneNumber,
		},
	}

	// NOTE: rides.driver_id stores the driver *user* id (see rides AcceptRide),
	// so the drivers join may resolve only user columns. Guard every nullable
	// dereference: a missing driver row must yield a null driver, never a panic.
	if detail.DriverID != nil && detail.DriverUserID != nil {
		result.Driver = &RideDriverInfo{
			ID:           *detail.DriverID,
			UserID:       *detail.DriverUserID,
			FirstName:    stringValue(detail.DriverFirstName),
			LastName:     stringValue(detail.DriverLastName),
			PhoneNumber:  stringValue(detail.DriverPhone),
			VehicleModel: stringValue(detail.VehicleModel),
			VehiclePlate: stringValue(detail.VehiclePlate),
			VehicleColor: stringValue(detail.VehicleColor),
			Rating:       floatValue(detail.DriverRating),
		}
	}

	return result, nil
}

func (r *Repository) GetRecentRidesWithDetails(ctx context.Context, limit, offset int) ([]*AdminRideDetail, int64, error) {
	var total int64
	if err := r.db.Primary.WithContext(ctx).Model(&models.Ride{}).Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("failed to count rides: %w", err)
	}

	var rawDetails []struct {
		models.Ride
		RiderEmail       string
		RiderFirstName   string
		RiderLastName    string
		RiderPhoneNumber string
		DriverID         *uuid.UUID
		DriverUserID     *uuid.UUID
		DriverFirstName  *string
		DriverLastName   *string
		DriverPhone      *string
		VehicleModel     *string
		VehiclePlate     *string
		VehicleColor     *string
		DriverRating     *float64
	}

	err := r.db.Primary.WithContext(ctx).Table("rides r").
		Select(`
			r.*,
			ru.email as rider_email, ru.first_name as rider_first_name, ru.last_name as rider_last_name, ru.phone_number as rider_phone_number,
			d.id as driver_id, d.user_id as driver_user_id, du.first_name as driver_first_name, du.last_name as driver_last_name, du.phone_number as driver_phone,
			d.vehicle_model, d.vehicle_plate, d.vehicle_color, d.rating as driver_rating
		`).
		Joins("JOIN users ru ON r.rider_id = ru.id").
		Joins("LEFT JOIN drivers d ON r.driver_id = d.id OR r.driver_id = d.user_id").
		Joins("LEFT JOIN users du ON d.user_id = du.id").
		Order("r.created_at DESC").
		Limit(limit).
		Offset(offset).
		Scan(&rawDetails).Error

	if err != nil {
		return nil, 0, fmt.Errorf("failed to get recent rides: %w", err)
	}

	rides := make([]*AdminRideDetail, 0, len(rawDetails))
	for i := range rawDetails {
		res := &AdminRideDetail{
			Ride: &rawDetails[i].Ride,
			Rider: &RideUserInfo{
				ID:          rawDetails[i].RiderID,
				Email:       rawDetails[i].RiderEmail,
				FirstName:   rawDetails[i].RiderFirstName,
				LastName:    rawDetails[i].RiderLastName,
				PhoneNumber: rawDetails[i].RiderPhoneNumber,
			},
		}

		// Same guard as GetRideByID: a missing driver row yields null driver, never a panic.
		if rawDetails[i].DriverID != nil && rawDetails[i].DriverUserID != nil {
			res.Driver = &RideDriverInfo{
				ID:           *rawDetails[i].DriverID,
				UserID:       *rawDetails[i].DriverUserID,
				FirstName:    stringValue(rawDetails[i].DriverFirstName),
				LastName:     stringValue(rawDetails[i].DriverLastName),
				PhoneNumber:  stringValue(rawDetails[i].DriverPhone),
				VehicleModel: stringValue(rawDetails[i].VehicleModel),
				VehiclePlate: stringValue(rawDetails[i].VehiclePlate),
				VehicleColor: stringValue(rawDetails[i].VehicleColor),
				Rating:       floatValue(rawDetails[i].DriverRating),
			}
		}
		rides = append(rides, res)
	}

	return rides, total, nil
}

func stringValue(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func floatValue(f *float64) float64 {
	if f == nil {
		return 0
	}
	return *f
}

func (r *Repository) GetRealtimeMetrics(ctx context.Context) (*RealtimeMetrics, error) {
	metrics := &RealtimeMetrics{}
	db := r.db.Primary.WithContext(ctx)

	var count int64
	if err := db.Model(&models.Ride{}).Where("status = ?", "in_progress").Count(&count).Error; err != nil {
		return nil, fmt.Errorf("failed to get active rides: %w", err)
	}
	metrics.ActiveRides = int(count)

	if err := db.Model(&models.Driver{}).Where("is_available = true AND is_online = true AND approval_status = 'approved'").Count(&count).Error; err != nil {
		return nil, fmt.Errorf("failed to get available drivers: %w", err)
	}
	metrics.AvailableDrivers = int(count)

	if err := db.Model(&models.Ride{}).Where("status = ?", "pending").Count(&count).Error; err != nil {
		return nil, fmt.Errorf("failed to get pending requests: %w", err)
	}
	metrics.PendingRequests = int(count)

	if err := db.Model(&models.Driver{}).Where("is_online = true").Count(&count).Error; err != nil {
		return nil, fmt.Errorf("failed to get online drivers: %w", err)
	}
	metrics.OnlineDrivers = int(count)

	today := time.Now().Truncate(24 * time.Hour)
	if err := db.Model(&models.Ride{}).Where("status = ? AND created_at >= ?", "completed", today).Select("COALESCE(SUM(final_fare), 0)").Scan(&metrics.TodayRevenue).Error; err != nil {
		return nil, fmt.Errorf("failed to get today revenue: %w", err)
	}

	yesterday := today.Add(-24 * time.Hour)
	var yesterdayRevenue float64
	if err := db.Model(&models.Ride{}).Where("status = ? AND created_at >= ? AND created_at < ?", "completed", yesterday, today).Select("COALESCE(SUM(final_fare), 0)").Scan(&yesterdayRevenue).Error; err != nil {
		return nil, fmt.Errorf("failed to get yesterday revenue: %w", err)
	}

	if yesterdayRevenue > 0 {
		metrics.TodayRevenueChange = ((metrics.TodayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100
	}

	if err := db.Model(&models.Ride{}).Where("created_at >= ?", today).Select("COUNT(DISTINCT rider_id)").Scan(&count).Error; err != nil {
		return nil, fmt.Errorf("failed to get active riders: %w", err)
	}
	metrics.TotalRidersActive = int(count)

	if err := db.Model(&models.Ride{}).Where("accepted_at IS NOT NULL AND requested_at IS NOT NULL AND created_at >= ?", today).Select("COALESCE(AVG(EXTRACT(EPOCH FROM (accepted_at - requested_at))/60), 0)").Scan(&metrics.AvgWaitTime).Error; err != nil {
		return nil, fmt.Errorf("failed to get avg wait time: %w", err)
	}

	if err := db.Model(&models.Ride{}).Where("estimated_duration IS NOT NULL AND created_at >= ?", today).Select("COALESCE(AVG(estimated_duration), 0)").Scan(&metrics.AvgETA).Error; err != nil {
		return nil, fmt.Errorf("failed to get avg eta: %w", err)
	}

	return metrics, nil
}

func (r *Repository) GetDashboardSummary(ctx context.Context, period string) (*DashboardSummary, error) {
	startDate, previousStart := r.getPeriodDates(period)

	summary := &DashboardSummary{
		Rides:   &SummaryRides{},
		Drivers: &SummaryDrivers{},
		Riders:  &SummaryRiders{},
		Revenue: &SummaryRevenue{},
		Alerts:  &SummaryAlerts{},
	}
	db := r.db.Primary.WithContext(ctx)

	query := `
		SELECT
			COUNT(*) as total,
			COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
			COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled,
			COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress,
			COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
			COALESCE(AVG(CASE WHEN status = 'completed' AND actual_duration IS NOT NULL THEN actual_duration END), 0) as avg_duration,
			COALESCE(AVG(CASE WHEN status = 'completed' AND actual_distance IS NOT NULL THEN actual_distance END), 0) as avg_distance
		FROM rides
		WHERE created_at >= ?
	`

	if err := db.Raw(query, startDate).Scan(summary.Rides).Error; err != nil {
		return nil, fmt.Errorf("failed to get ride stats: %w", err)
	}

	if summary.Rides.Total > 0 {
		summary.Rides.CompletionRate = float64(summary.Rides.Completed) / float64(summary.Rides.Total) * 100
		summary.Rides.CancellationRate = float64(summary.Rides.Cancelled) / float64(summary.Rides.Total) * 100
	}

	var count64 int64
	db.Model(&models.Ride{}).Where("status = 'cancelled' AND cancellation_reason LIKE ? AND created_at >= ?", "%rider%", startDate).Count(&count64)
	summary.Rides.CancelledByRider = int(count64)

	db.Model(&models.Ride{}).Where("status = 'cancelled' AND cancellation_reason LIKE ? AND created_at >= ?", "%driver%", startDate).Count(&count64)
	summary.Rides.CancelledByDriver = int(count64)

	db.Model(&models.Ride{}).Where("created_at >= ? AND created_at < ?", previousStart, startDate).Count(&count64)
	if count64 > 0 {
		summary.Rides.ChangeVsPrevious = float64(int64(summary.Rides.Total)-count64) / float64(count64) * 100
	}

	db.Model(&models.Driver{}).Where("approval_status = 'approved'").Count(&count64)
	summary.Drivers.TotalActive = int(count64)

	db.Model(&models.Driver{}).Where("is_online = true AND approval_status = 'approved'").Count(&count64)
	summary.Drivers.OnlineNow = int(count64)

	db.Model(&models.Driver{}).Where("is_online = true AND is_available = true AND approval_status = 'approved'").Count(&count64)
	summary.Drivers.AvailableNow = int(count64)

	summary.Drivers.BusyNow = summary.Drivers.OnlineNow - summary.Drivers.AvailableNow

	db.Model(&models.Driver{}).Where("approval_status = 'pending'").Count(&count64)
	summary.Drivers.PendingApprovals = int(count64)

	db.Model(&models.Driver{}).Where("rating > 0").Select("COALESCE(AVG(rating), 0)").Scan(&summary.Drivers.AvgRating)

	db.Model(&models.Driver{}).Where("created_at >= ?", startDate).Count(&count64)
	summary.Drivers.NewSignups = int(count64)

	var totalOnlineTime, totalBusyTime float64
	db.Table("rides").
		Select(`
			COUNT(DISTINCT driver_id) * EXTRACT(EPOCH FROM (NOW() - ?))/3600 as total_hours,
			COALESCE(SUM(actual_duration/60), 0) as busy_hours
		`, startDate).
		Where("created_at >= ? AND status = 'completed'", startDate).
		Row().Scan(&totalOnlineTime, &totalBusyTime)

	if totalOnlineTime > 0 {
		summary.Drivers.UtilizationRate = (totalBusyTime / totalOnlineTime) * 100
	}

	db.Model(&models.User{}).Where("role = 'rider' AND is_active = true").Count(&count64)
	summary.Riders.TotalActive = int(count64)

	db.Model(&models.User{}).Where("role = 'rider' AND created_at >= ?", startDate).Count(&count64)
	summary.Riders.NewSignups = int(count64)

	db.Model(&models.Ride{}).Where("created_at >= ?", startDate).Select("COUNT(DISTINCT rider_id)").Scan(&count64)
	summary.Riders.ActiveToday = int(count64)

	db.Table("(SELECT rider_id FROM rides GROUP BY rider_id HAVING COUNT(*) > 1) as repeat_riders").Count(&count64)

	if summary.Riders.TotalActive > 0 {
		summary.Riders.RetentionRate = float64(count64) / float64(summary.Riders.TotalActive) * 100
	}

	db.Model(&models.Ride{}).
		Where("status = 'completed' AND created_at >= ?", startDate).
		Select("COALESCE(SUM(final_fare), 0), COALESCE(AVG(final_fare), 0)").
		Row().Scan(&summary.Revenue.Total, &summary.Revenue.AvgFare)

	summary.Revenue.Commission = summary.Revenue.Total * 0.20
	summary.Revenue.DriverEarnings = summary.Revenue.Total - summary.Revenue.Commission

	var previousRevenue float64
	db.Model(&models.Ride{}).
		Where("status = 'completed' AND created_at >= ? AND created_at < ?", previousStart, startDate).
		Select("COALESCE(SUM(final_fare), 0)").
		Scan(&previousRevenue)

	if previousRevenue > 0 {
		summary.Revenue.ChangeVsPrevious = ((summary.Revenue.Total - previousRevenue) / previousRevenue) * 100
	}

	summary.Revenue.ByPaymentMethod = []PaymentMethodRevenue{
		{Method: "cash", Amount: summary.Revenue.Total * 0.05, Percentage: 5.0},
	}

	db.Table("fraud_alerts").Where("status = 'pending'").Count(&count64)
	summary.Alerts.FraudAlerts = int(count64)

	db.Table("fraud_alerts").Where("alert_level = 'critical' AND status = 'pending'").Count(&count64)
	summary.Alerts.CriticalAlerts = int(count64)

	db.Table("fraud_alerts").Where("status = 'investigating'").Count(&count64)
	summary.Alerts.PendingInvestigations = int(count64)

	return summary, nil
}

func (r *Repository) getPeriodDates(period string) (time.Time, time.Time) {
	now := time.Now()
	var startDate, previousStart time.Time

	switch period {
	case "today":
		startDate = now.Truncate(24 * time.Hour)
		previousStart = startDate.Add(-24 * time.Hour)
	case "week":
		startDate = now.AddDate(0, 0, -7).Truncate(24 * time.Hour)
		previousStart = startDate.Add(-7 * 24 * time.Hour)
	case "month":
		startDate = now.AddDate(0, -1, 0).Truncate(24 * time.Hour)
		previousStart = startDate.AddDate(0, -1, 0)
	default:
		startDate = time.Time{}
		previousStart = time.Time{}
	}

	return startDate, previousStart
}

func (r *Repository) GetRevenueTrend(ctx context.Context, period, groupBy string) (*RevenueTrend, error) {
	startDate, days := r.getPeriodStartDate(period)

	trend := &RevenueTrend{
		Period:  period,
		GroupBy: groupBy,
		Trend:   make([]RevenueTrendData, 0),
	}

	err := r.db.Primary.WithContext(ctx).Model(&models.Ride{}).
		Where("status = 'completed' AND created_at >= ?", startDate).
		Select("COALESCE(SUM(final_fare), 0)").
		Scan(&trend.TotalRevenue).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get total revenue: %w", err)
	}

	if days > 0 {
		trend.AvgDailyRevenue = trend.TotalRevenue / float64(days)
	}

	query := r.buildRevenueTrendQuery(groupBy)

	rows, err := r.db.Primary.WithContext(ctx).Raw(query, startDate).Rows()
	if err != nil {
		return nil, fmt.Errorf("failed to get revenue trend: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var data RevenueTrendData
		var dateValue interface{}

		err := rows.Scan(&dateValue, &data.Revenue, &data.Rides, &data.AvgFare, &data.Commission)
		if err != nil {
			return nil, fmt.Errorf("failed to scan trend data: %w", err)
		}

		data.Date = r.formatTrendDate(dateValue, groupBy)
		trend.Trend = append(trend.Trend, data)
	}

	return trend, nil
}

func (r *Repository) buildRevenueTrendQuery(groupBy string) string {
	baseQuery := `
		SELECT
			%s as date,
			COALESCE(SUM(final_fare), 0) as revenue,
			COUNT(*) as rides,
			COALESCE(AVG(final_fare), 0) as avg_fare,
			COALESCE(SUM(final_fare), 0) * 0.20 as commission
		FROM rides
		WHERE status = 'completed' AND created_at >= $1
		GROUP BY %s
		ORDER BY %s ASC
	`

	switch groupBy {
	case "hour":
		groupExpr := "DATE_TRUNC('hour', created_at)"
		return fmt.Sprintf(baseQuery, groupExpr, groupExpr, groupExpr)
	case "day":
		groupExpr := "DATE(created_at)"
		return fmt.Sprintf(baseQuery, groupExpr, groupExpr, groupExpr)
	case "week":
		groupExpr := "DATE_TRUNC('week', created_at)"
		return fmt.Sprintf(baseQuery, groupExpr, groupExpr, groupExpr)
	case "month":
		groupExpr := "DATE_TRUNC('month', created_at)"
		return fmt.Sprintf(baseQuery, groupExpr, groupExpr, groupExpr)
	default:
		groupExpr := "DATE(created_at)"
		return fmt.Sprintf(baseQuery, groupExpr, groupExpr, groupExpr)
	}
}

func (r *Repository) formatTrendDate(dateValue interface{}, groupBy string) string {
	switch v := dateValue.(type) {
	case time.Time:
		switch groupBy {
		case "hour":
			return v.Format("2006-01-02 15:00")
		case "week":
			return v.Format("2006-01-02")
		case "month":
			return v.Format("2006-01")
		default:
			return v.Format("2006-01-02")
		}
	default:
		return fmt.Sprintf("%v", dateValue)
	}
}

func (r *Repository) getPeriodDays(period string) int {
	switch period {
	case "today":
		return 1
	case "7days":
		return 7
	case "30days":
		return 30
	case "90days":
		return 90
	case "year":
		return 365
	default:
		return 7
	}
}

func (r *Repository) getPeriodStartDate(period string) (time.Time, int) {
	now := time.Now()
	var startDate time.Time
	var days int

	switch period {
	case "today":
		startDate = now.Truncate(24 * time.Hour)
		days = 1
	case "7days":
		startDate = now.AddDate(0, 0, -7).Truncate(24 * time.Hour)
		days = 7
	case "30days":
		startDate = now.AddDate(0, 0, -30).Truncate(24 * time.Hour)
		days = 30
	case "90days":
		startDate = now.AddDate(0, 0, -90).Truncate(24 * time.Hour)
		days = 90
	case "year":
		startDate = now.AddDate(-1, 0, 0).Truncate(24 * time.Hour)
		days = 365
	default:
		startDate = now.AddDate(0, 0, -7).Truncate(24 * time.Hour)
		days = 7
	}

	return startDate, days
}

func (r *Repository) GetActionItems(ctx context.Context) (*ActionItems, error) {
	items := &ActionItems{
		PendingDriverApprovals: &ActionDriverApprovals{Items: make([]PendingDriverItem, 0)},
		FraudAlerts:            &ActionFraudAlerts{Items: make([]FraudAlertItem, 0)},
		NegativeFeedback:       &ActionNegativeFeedback{Items: make([]NegativeFeedbackItem, 0)},
		LowBalanceDrivers:      &ActionLowBalance{Items: make([]LowBalanceItem, 0)},
		ExpiredDocuments:       &ActionExpiredDocs{Items: make([]ExpiredDocItem, 0)},
	}
	db := r.db.Primary.WithContext(ctx)

	var count int64
	db.Model(&models.Driver{}).Where("approval_status = 'pending'").Count(&count)
	items.PendingDriverApprovals.Count = int(count)

	db.Model(&models.Driver{}).Where("approval_status = 'pending' AND created_at < NOW() - INTERVAL '24 hours'").Count(&count)
	items.PendingDriverApprovals.UrgentCount = int(count)

	var pendingDrivers []struct {
		ID          uuid.UUID
		Name        string
		CreatedAt   time.Time
		DaysWaiting int
	}
	err := db.Table("drivers d").
		Select("d.id, CONCAT(u.first_name, ' ', u.last_name) as name, d.created_at, EXTRACT(DAY FROM (NOW() - d.created_at)) as days_waiting").
		Joins("JOIN users u ON d.user_id = u.id").
		Where("d.approval_status = 'pending'").
		Order("d.created_at ASC").
		Limit(5).
		Scan(&pendingDrivers).Error

	if err == nil {
		for _, pd := range pendingDrivers {
			items.PendingDriverApprovals.Items = append(items.PendingDriverApprovals.Items, PendingDriverItem{
				DriverID:    pd.ID,
				DriverName:  pd.Name,
				SubmittedAt: pd.CreatedAt,
				DaysWaiting: pd.DaysWaiting,
			})
		}
	}

	db.Table("fraud_alerts").Where("status = 'pending'").Count(&count)
	items.FraudAlerts.Count = int(count)

	db.Table("fraud_alerts").Where("alert_level = 'critical' AND status = 'pending'").Count(&count)
	items.FraudAlerts.CriticalCount = int(count)

	db.Table("fraud_alerts").Where("alert_level = 'high' AND status = 'pending'").Count(&count)
	items.FraudAlerts.HighCount = int(count)

	var fraudAlerts []FraudAlertItem
	err = db.Table("fraud_alerts").
		Select("id as alert_id, alert_type, alert_level, user_id, created_at").
		Where("status = 'pending'").
		Order("alert_level DESC, created_at DESC").
		Limit(5).
		Scan(&fraudAlerts).Error
	if err == nil {
		items.FraudAlerts.Items = fraudAlerts
	}

	db.Model(&models.Ride{}).Where("rating IS NOT NULL AND rating <= 2").Count(&count)
	items.NegativeFeedback.Count = int(count)

	db.Model(&models.Ride{}).Where("rating = 1").Count(&count)
	items.NegativeFeedback.OneStarCount = int(count)

	var feedbacks []struct {
		RideID     uuid.UUID
		DriverID   *uuid.UUID
		DriverName string
		Rating     int
		Feedback   string
		CreatedAt  time.Time
	}
	err = db.Table("rides r").
		Select("r.id as ride_id, r.driver_id, CONCAT(u.first_name, ' ', u.last_name) as driver_name, r.rating, r.feedback, r.created_at").
		Joins("LEFT JOIN drivers d ON r.driver_id = d.id").
		Joins("LEFT JOIN users u ON d.user_id = u.id").
		Where("r.rating IS NOT NULL AND r.rating <= 2").
		Order("r.created_at DESC").
		Limit(5).
		Scan(&feedbacks).Error

	if err == nil {
		for _, f := range feedbacks {
			rating := f.Rating
			fb := f.Feedback
			items.NegativeFeedback.Items = append(items.NegativeFeedback.Items, NegativeFeedbackItem{
				RideID:     f.RideID,
				DriverID:   f.DriverID,
				DriverName: f.DriverName,
				Rating:     &rating,
				Feedback:   &fb,
				CreatedAt:  f.CreatedAt,
			})
		}
	}

	items.LowBalanceDrivers.Count = 0

	items.ExpiredDocuments.Count = 0

	return items, nil
}
