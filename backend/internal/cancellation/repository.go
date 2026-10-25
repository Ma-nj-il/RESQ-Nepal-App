package cancellation

import (
	"context"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/bikky-kc013/medi-ambulance/pkg/database"
)

type Repository struct {
	db *database.DBPool
}

func NewRepository(db *database.DBPool) *Repository {
	return &Repository{db: db}
}

func (r *Repository) CreateCancellationRecord(ctx context.Context, rec *CancellationRecord) error {
	return r.db.Primary.WithContext(ctx).Create(rec).Error
}

func (r *Repository) GetCancellationByRideID(ctx context.Context, rideID uuid.UUID) (*CancellationRecord, error) {
	var rec CancellationRecord
	err := r.db.Primary.WithContext(ctx).Where("ride_id = ?", rideID).First(&rec).Error
	if err != nil {
		return nil, err
	}
	return &rec, nil
}

func (r *Repository) GetCancellationByID(ctx context.Context, id uuid.UUID) (*CancellationRecord, error) {
	var rec CancellationRecord
	err := r.db.Primary.WithContext(ctx).First(&rec, "id = ?", id).Error
	if err != nil {
		return nil, err
	}
	return &rec, nil
}

func (r *Repository) CountUserCancellationsToday(ctx context.Context, userID uuid.UUID, cancelledBy CancelledBy) (int, error) {
	today := time.Now().Truncate(24 * time.Hour)
	var count int64
	err := r.db.Primary.WithContext(ctx).Model(&CancellationRecord{}).
		Where("(rider_id = ? OR driver_id = ?) AND cancelled_by = ? AND cancelled_at >= ?", userID, cancelledBy, today).
		Count(&count).Error
	return int(count), err
}

func (r *Repository) CountUserCancellationsThisWeek(ctx context.Context, userID uuid.UUID, cancelledBy CancelledBy) (int, error) {
	now := time.Now()
	weekday := int(now.Weekday())
	if weekday == 0 {
		weekday = 7
	}
	startOfWeek := now.AddDate(0, 0, -(weekday - 1)).Truncate(24 * time.Hour)
	var count int64
	err := r.db.Primary.WithContext(ctx).Model(&CancellationRecord{}).
		Where("(rider_id = ? OR driver_id = ?) AND cancelled_by = ? AND cancelled_at >= ?", userID, cancelledBy, startOfWeek).
		Count(&count).Error
	return int(count), err
}

func (r *Repository) GetUserCancellationStats(ctx context.Context, userID uuid.UUID) (*UserCancellationStats, error) {
	now := time.Now()
	today := now.Truncate(24 * time.Hour)
	weekday := int(now.Weekday())
	if weekday == 0 {
		weekday = 7
	}
	startOfWeek := now.AddDate(0, 0, -(weekday - 1)).Truncate(24 * time.Hour)
	startOfMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())

	stats := &UserCancellationStats{UserID: userID}

	var results struct {
		TotalCancellations     int
		TotalFeesCharged       float64
		TotalFeesWaived        float64
		CancellationsToday     int
		CancellationsThisWeek  int
		CancellationsThisMonth int
		LastCancellationAt     *time.Time
	}

	db := r.db.Primary.WithContext(ctx)

	err := db.Table("cancellation_records").
		Select(`
			COUNT(*) as total_cancellations,
			COALESCE(SUM(CASE WHEN fee_waived = false THEN fee_amount ELSE 0 END), 0) as total_fees_charged,
			COALESCE(SUM(CASE WHEN fee_waived = true THEN fee_amount ELSE 0 END), 0) as total_fees_waived,
			COUNT(CASE WHEN cancelled_at >= ? THEN 1 END) as cancellations_today,
			COUNT(CASE WHEN cancelled_at >= ? THEN 1 END) as cancellations_this_week,
			COUNT(CASE WHEN cancelled_at >= ? THEN 1 END) as cancellations_this_month,
			MAX(cancelled_at) as last_cancellation_at
		`, today, startOfWeek, startOfMonth).
		Where("(rider_id = ? OR driver_id = ?) AND cancelled_by != 'system'", userID, userID).
		Scan(&results).Error

	if err != nil {
		return nil, err
	}

	stats.TotalCancellations = results.TotalCancellations
	stats.TotalFeesCharged = results.TotalFeesCharged
	stats.TotalFeesWaived = results.TotalFeesWaived
	stats.CancellationsToday = results.CancellationsToday
	stats.CancellationsThisWeek = results.CancellationsThisWeek
	stats.CancellationsThisMonth = results.CancellationsThisMonth
	stats.LastCancellationAt = results.LastCancellationAt

	var totalRides int64
	db.Table("rides").
		Where("(rider_id = ? OR driver_id = ?) AND created_at >= ?", userID, userID, now.AddDate(0, 0, -30)).
		Count(&totalRides)

	var recentCancels int64
	db.Table("cancellation_records").
		Where("(rider_id = ? OR driver_id = ?) AND cancelled_by != 'system' AND cancelled_at >= ?", userID, userID, now.AddDate(0, 0, -30)).
		Count(&recentCancels)

	if totalRides > 0 {
		stats.CancellationRate = float64(recentCancels) / float64(totalRides) * 100
	}

	return stats, nil
}

func (r *Repository) GetUserCancellationHistory(ctx context.Context, userID uuid.UUID, limit, offset int) ([]CancellationRecord, int, error) {
	var total int64
	err := r.db.Primary.WithContext(ctx).Model(&CancellationRecord{}).
		Where("rider_id = ? OR driver_id = ?", userID, userID).
		Count(&total).Error
	if err != nil {
		return nil, 0, err
	}

	var records []CancellationRecord
	err = r.db.Primary.WithContext(ctx).
		Where("rider_id = ? OR driver_id = ?", userID, userID).
		Order("cancelled_at DESC").
		Limit(limit).Offset(offset).
		Find(&records).Error

	if err != nil {
		return nil, 0, err
	}

	return records, int(total), nil
}

func (r *Repository) WaiveCancellationFee(ctx context.Context, id uuid.UUID, reason string) error {
	waiver := FeeWaiverReason(WaiverAdminOverride)
	return r.db.Primary.WithContext(ctx).Model(&CancellationRecord{}).
		Where("id = ?", id).
		Updates(map[string]interface{}{
			"fee_waived":    true,
			"waiver_reason": waiver,
			"reason_text":   gorm.Expr("COALESCE(reason_text, '') || ?", " [Admin waived: "+reason+"]"),
		}).Error
}

func (r *Repository) GetDefaultPolicy(ctx context.Context) (*CancellationPolicy, error) {
	var policy CancellationPolicy
	err := r.db.Primary.WithContext(ctx).
		Where("is_default = ? AND is_active = ?", true, true).
		First(&policy).Error
	if err != nil {
		return nil, err
	}
	return &policy, nil
}

func (r *Repository) GetCancellationStats(ctx context.Context, from, to time.Time) (*CancellationStatsResponse, error) {
	stats := &CancellationStatsResponse{}

	var results struct {
		TotalCancellations     int
		RiderCancellations     int
		DriverCancellations    int
		SystemCancellations    int
		TotalFeesCollected     float64
		TotalFeesWaived        float64
		AverageMinutesToCancel float64
	}

	err := r.db.Primary.WithContext(ctx).Table("cancellation_records").
		Select(`
			COUNT(*) as total_cancellations,
			COUNT(CASE WHEN cancelled_by = 'rider' THEN 1 END) as rider_cancellations,
			COUNT(CASE WHEN cancelled_by = 'driver' THEN 1 END) as driver_cancellations,
			COUNT(CASE WHEN cancelled_by = 'system' THEN 1 END) as system_cancellations,
			SUM(CASE WHEN fee_waived = false THEN fee_amount ELSE 0 END) as total_fees_collected,
			SUM(CASE WHEN fee_waived = true THEN fee_amount ELSE 0 END) as total_fees_waived,
			AVG(minutes_since_request) as average_minutes_to_cancel
		`).
		Where("cancelled_at >= ? AND cancelled_at < ?", from, to).
		Scan(&results).Error

	if err != nil {
		return nil, err
	}

	stats.TotalCancellations = results.TotalCancellations
	stats.RiderCancellations = results.RiderCancellations
	stats.DriverCancellations = results.DriverCancellations
	stats.SystemCancellations = results.SystemCancellations
	stats.TotalFeesCollected = results.TotalFeesCollected
	stats.TotalFeesWaived = results.TotalFeesWaived
	stats.AverageMinutesToCancel = results.AverageMinutesToCancel

	var totalRides int64
	r.db.Primary.WithContext(ctx).Table("rides").
		Where("created_at >= ? AND created_at < ?", from, to).
		Count(&totalRides)

	if totalRides > 0 {
		stats.CancellationRate = float64(stats.TotalCancellations) / float64(totalRides) * 100
	}

	r.db.Primary.WithContext(ctx).Table("cancellation_records").
		Select("reason_code, COUNT(*) as count").
		Where("cancelled_at >= ? AND cancelled_at < ?", from, to).
		Group("reason_code").
		Order("count DESC").
		Limit(10).
		Scan(&stats.TopReasons)

	for i := range stats.TopReasons {
		if stats.TotalCancellations > 0 {
			stats.TopReasons[i].Percentage = float64(stats.TopReasons[i].Count) / float64(stats.TotalCancellations) * 100
		}
	}

	if stats.TopReasons == nil {
		stats.TopReasons = []TopCancellationReason{}
	}

	return stats, nil
}
