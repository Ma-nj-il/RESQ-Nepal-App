package analytics

import (
	"context"
	"fmt"
	"time"

	analyticsModels "github.com/bikky-kc013/medi-ambulance/internal/analytics/models"
	"github.com/bikky-kc013/medi-ambulance/pkg/database"
	"github.com/bikky-kc013/medi-ambulance/pkg/models"
	"github.com/google/uuid"
)

const (
	commissionRate = 0.20
)

type Repository struct {
	db *database.DBPool
}

var _ AnalyticsRepository = (*Repository)(nil)

func NewRepository(db *database.DBPool) *Repository {
	return &Repository{db: db}
}

func (r *Repository) GetRevenueMetrics(ctx context.Context, startDate, endDate time.Time) (*analyticsModels.RevenueMetrics, error) {
	type result struct {
		TotalRides     int64
		TotalRevenue   float64
		AvgFarePerRide float64
		TotalDiscounts float64
	}

	var res result
	err := r.db.GetReplica().WithContext(ctx).
		Model(&models.Ride{}).
		Select(`
			COUNT(*) AS total_rides,
			COALESCE(SUM(final_fare), 0) AS total_revenue,
			COALESCE(AVG(final_fare), 0) AS avg_fare_per_ride,
			COALESCE(SUM(discount_amount), 0) AS total_discounts
		`).
		Where("status = ? AND completed_at >= ? AND completed_at <= ?", "completed", startDate, endDate).
		Scan(&res).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get revenue metrics: %w", err)
	}

	netRevenue := res.TotalRevenue - res.TotalDiscounts

	metrics := &analyticsModels.RevenueMetrics{
		TotalRides:       int(res.TotalRides),
		TotalRevenue:     res.TotalRevenue,
		AvgFarePerRide:   res.AvgFarePerRide,
		TotalDiscounts:   res.TotalDiscounts,
		PlatformEarnings: netRevenue * commissionRate,
		DriverEarnings:   netRevenue * (1 - commissionRate),
		Period:           fmt.Sprintf("%s to %s", startDate.Format("2006-01-02"), endDate.Format("2006-01-02")),
	}
	return metrics, nil
}

func (r *Repository) GetRideTypeStats(ctx context.Context, startDate, endDate time.Time) ([]*analyticsModels.RideTypeStats, error) {
	type result struct {
		RideTypeID   uuid.UUID
		Name         string
		TotalRides   int
		TotalRevenue float64
		AvgFare      float64
		Percentage   float64
	}

	var rows []result
	err := r.db.GetReplica().WithContext(ctx).
		Table("ride_types rt").
		Select(`
			rt.id AS ride_type_id,
			rt.name,
			COUNT(r.id) AS total_rides,
			COALESCE(SUM(r.final_fare), 0) AS total_revenue,
			COALESCE(AVG(r.final_fare), 0) AS avg_fare,
			CASE
				WHEN (SELECT COUNT(*) FROM rides
				      WHERE status = 'completed'
				        AND completed_at >= ? AND completed_at <= ?) > 0
				THEN COUNT(r.id)::float /
				     (SELECT COUNT(*) FROM rides
				      WHERE status = 'completed'
				        AND completed_at >= ? AND completed_at <= ?) * 100
				ELSE 0
			END AS percentage
		`, startDate, endDate, startDate, endDate).
		Joins(`LEFT JOIN rides r ON rt.id = r.ride_type_id
			AND r.status = 'completed'
			AND r.completed_at >= ?
			AND r.completed_at <= ?`, startDate, endDate).
		Group("rt.id, rt.name").
		Order("total_rides DESC").
		Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get ride type stats: %w", err)
	}

	results := make([]*analyticsModels.RideTypeStats, 0, len(rows))
	for _, row := range rows {
		results = append(results, &analyticsModels.RideTypeStats{
			RideTypeID:   row.RideTypeID,
			Name:         row.Name,
			TotalRides:   row.TotalRides,
			TotalRevenue: row.TotalRevenue,
			AvgFare:      row.AvgFare,
			Percentage:   row.Percentage,
		})
	}
	return results, nil
}

func (r *Repository) GetTopDrivers(ctx context.Context, startDate, endDate time.Time, limit int) ([]*analyticsModels.DriverPerformance, error) {
	type result struct {
		DriverID         uuid.UUID
		DriverName       string
		TotalRides       int
		TotalEarnings    float64
		AvgRating        float64
		CompletionRate   float64
		CancellationRate float64
	}

	var rows []result
	err := r.db.GetReplica().WithContext(ctx).
		Table("users u").
		Select(`
			u.id AS driver_id,
			COALESCE(u.first_name || ' ' || u.last_name, u.email) AS driver_name,
			COUNT(r.id) AS total_rides,
			COALESCE(SUM(r.final_fare) * ?, 0) AS total_earnings,
			COALESCE(AVG(r.rating), 0) AS avg_rating,
			CASE
				WHEN COUNT(r.id) > 0
				THEN COUNT(*) FILTER (WHERE r.status = 'completed')::float / COUNT(*) * 100
				ELSE 0
			END AS completion_rate,
			CASE
				WHEN COUNT(r.id) > 0
				THEN COUNT(*) FILTER (WHERE r.status = 'cancelled')::float / COUNT(*) * 100
				ELSE 0
			END AS cancellation_rate
		`, 1-commissionRate).
		Joins("INNER JOIN rides r ON u.id = r.driver_id").
		Where("u.role = ? AND r.completed_at >= ? AND r.completed_at <= ?", "driver", startDate, endDate).
		Group("u.id, driver_name").
		Order("total_earnings DESC").
		Limit(limit).
		Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get top drivers: %w", err)
	}

	results := make([]*analyticsModels.DriverPerformance, 0, len(rows))
	for _, row := range rows {
		results = append(results, &analyticsModels.DriverPerformance{
			DriverID:         row.DriverID,
			DriverName:       row.DriverName,
			TotalRides:       row.TotalRides,
			TotalEarnings:    row.TotalEarnings,
			AvgRating:        row.AvgRating,
			CompletionRate:   row.CompletionRate,
			CancellationRate: row.CancellationRate,
		})
	}
	return results, nil
}

func (r *Repository) GetDashboardMetrics(ctx context.Context) (*analyticsModels.DashboardMetrics, error) {
	today := time.Now().Truncate(24 * time.Hour)
	tomorrow := today.Add(24 * time.Hour)

	metrics := &analyticsModels.DashboardMetrics{}

	type rideResult struct {
		TotalRides     int64
		ActiveRides    int64
		CompletedToday int64
		RevenueToday   float64
		AvgRating      float64
	}
	var rr rideResult
	err := r.db.GetReplica().WithContext(ctx).
		Model(&models.Ride{}).
		Select(`
			COUNT(*) AS total_rides,
			COUNT(*) FILTER (WHERE status IN ('requested','accepted','in_progress')) AS active_rides,
			COUNT(*) FILTER (WHERE status = 'completed' AND completed_at >= ? AND completed_at < ?) AS completed_today,
			COALESCE(SUM(final_fare) FILTER (WHERE status = 'completed' AND completed_at >= ? AND completed_at < ?), 0) AS revenue_today,
			COALESCE(AVG(rating) FILTER (WHERE rating IS NOT NULL), 0) AS avg_rating
		`, today, tomorrow, today, tomorrow).
		Scan(&rr).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get dashboard ride metrics: %w", err)
	}
	metrics.TotalRides = int(rr.TotalRides)
	metrics.ActiveRides = int(rr.ActiveRides)
	metrics.CompletedToday = int(rr.CompletedToday)
	metrics.RevenueToday = rr.RevenueToday
	metrics.AvgRating = rr.AvgRating

	type userResult struct {
		ActiveDrivers int64
		ActiveRiders  int64
	}
	var ur userResult
	err = r.db.GetReplica().WithContext(ctx).
		Model(&models.User{}).
		Select(`
			COUNT(DISTINCT CASE WHEN role = 'driver' THEN id END) AS active_drivers,
			COUNT(DISTINCT CASE WHEN role = 'rider' THEN id END) AS active_riders
		`).
		Where("is_active = true").
		Scan(&ur).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get dashboard user metrics: %w", err)
	}
	metrics.ActiveDrivers = int(ur.ActiveDrivers)
	metrics.ActiveRiders = int(ur.ActiveRiders)

	if rideTypes, err := r.GetRideTypeStats(ctx, today, tomorrow); err == nil && len(rideTypes) > 0 {
		metrics.TopRideType = rideTypes[0]
	}

	return metrics, nil
}

func (r *Repository) GetDemandHeatMap(ctx context.Context, startDate, endDate time.Time, gridSize float64) ([]*analyticsModels.DemandHeatMap, error) {
	if gridSize == 0 {
		gridSize = 0.01
	}

	type result struct {
		Latitude    float64
		Longitude   float64
		RideCount   int64
		AvgWaitTime int
		AvgFare     float64
		AvgSurge    float64
	}

	var rows []result
	err := r.db.GetReplica().WithContext(ctx).
		Model(&models.Ride{}).
		Select(`
			ROUND(pickup_latitude / ?) * ? AS latitude,
			ROUND(pickup_longitude / ?) * ? AS longitude,
			COUNT(*) AS ride_count,
			COALESCE(AVG(EXTRACT(EPOCH FROM (accepted_at - requested_at)) / 60), 0)::int AS avg_wait_time,
			COALESCE(AVG(final_fare), 0) AS avg_fare,
			COALESCE(AVG(surge_multiplier), 1.0) AS avg_surge
		`, gridSize, gridSize, gridSize, gridSize).
		Where("created_at >= ? AND created_at <= ? AND pickup_latitude IS NOT NULL AND pickup_longitude IS NOT NULL", startDate, endDate).
		Group("latitude, longitude").
		Having("COUNT(*) >= 1").
		Order("ride_count DESC").
		Limit(100).
		Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get demand heat map: %w", err)
	}

	results := make([]*analyticsModels.DemandHeatMap, 0, len(rows))
	for _, row := range rows {
		heatMap := &analyticsModels.DemandHeatMap{
			Latitude:    row.Latitude,
			Longitude:   row.Longitude,
			RideCount:   int(row.RideCount),
			AvgWaitTime: row.AvgWaitTime,
			AvgFare:     row.AvgFare,
			SurgeActive: row.AvgSurge > 1.0,
		}
		switch {
		case heatMap.RideCount >= 50:
			heatMap.DemandLevel = "very_high"
		case heatMap.RideCount >= 20:
			heatMap.DemandLevel = "high"
		case heatMap.RideCount >= 10:
			heatMap.DemandLevel = "medium"
		default:
			heatMap.DemandLevel = "low"
		}
		results = append(results, heatMap)
	}
	return results, nil
}

func (r *Repository) GetFinancialReport(ctx context.Context, startDate, endDate time.Time) (*analyticsModels.FinancialReport, error) {
	report := &analyticsModels.FinancialReport{
		Period: fmt.Sprintf("%s to %s", startDate.Format("2006-01-02"), endDate.Format("2006-01-02")),
	}

	type rideResult struct {
		CompletedRides    int64
		CancelledRides    int64
		TotalRides        int64
		GrossRevenue      float64
		AvgRevenuePerRide float64
	}
	var rr rideResult
	err := r.db.GetReplica().WithContext(ctx).
		Model(&models.Ride{}).
		Select(`
			COUNT(*) FILTER (WHERE status = 'completed') AS completed_rides,
			COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled_rides,
			COUNT(*) AS total_rides,
			COALESCE(SUM(final_fare) FILTER (WHERE status = 'completed'), 0) AS gross_revenue,
			COALESCE(AVG(final_fare) FILTER (WHERE status = 'completed'), 0) AS avg_revenue_per_ride
		`).
		Where("requested_at >= ? AND requested_at <= ?", startDate, endDate).
		Scan(&rr).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get ride statistics: %w", err)
	}
	report.CompletedRides = int(rr.CompletedRides)
	report.CancelledRides = int(rr.CancelledRides)
	report.TotalRides = int(rr.TotalRides)
	report.GrossRevenue = rr.GrossRevenue
	report.AvgRevenuePerRide = rr.AvgRevenuePerRide
	report.PlatformCommission = report.GrossRevenue * commissionRate
	report.DriverPayouts = report.GrossRevenue * (1 - commissionRate)

	var refunds float64
	if err = r.db.GetReplica().WithContext(ctx).
		Model(&models.Payment{}).
		Select("COALESCE(SUM(amount), 0)").
		Where("status = ? AND created_at >= ? AND created_at <= ?", "refunded", startDate, endDate).
		Scan(&refunds).Error; err != nil {
		return nil, fmt.Errorf("failed to get refunds: %w", err)
	}
	report.Refunds = refunds

	report.TotalExpenses = report.DriverPayouts + report.Refunds
	report.NetRevenue = report.GrossRevenue
	report.Profit = report.PlatformCommission - report.ReferralBonuses - report.Refunds
	if report.NetRevenue > 0 {
		report.ProfitMargin = (report.Profit / report.NetRevenue) * 100
	}

	type dayResult struct {
		RevenueDay          time.Time
		TopRevenueDayAmount float64
	}
	var dr dayResult
	err = r.db.GetReplica().WithContext(ctx).
		Model(&models.Ride{}).
		Select("DATE(completed_at) AS revenue_day, SUM(final_fare) AS top_revenue_day_amount").
		Where("status = 'completed' AND completed_at >= ? AND completed_at <= ?", startDate, endDate).
		Group("revenue_day").
		Order("top_revenue_day_amount DESC").
		Limit(1).
		Scan(&dr).Error
	if err == nil && !dr.RevenueDay.IsZero() {
		report.TopRevenueDay = dr.RevenueDay.Format("2006-01-02")
		report.TopRevenueDayAmount = dr.TopRevenueDayAmount
	}

	return report, nil
}

func (r *Repository) GetDemandZones(ctx context.Context, startDate, endDate time.Time, minRides int) ([]*analyticsModels.DemandZone, error) {
	if minRides == 0 {
		minRides = 1
	}

	type result struct {
		ZoneLatitude  float64
		ZoneLongitude float64
		RideCount     int64
		AvgSurge      float64
	}

	var rows []result
	err := r.db.GetReplica().WithContext(ctx).
		Model(&models.Ride{}).
		Select(`
			ROUND(pickup_latitude / 0.05) * 0.05  AS zone_latitude,
			ROUND(pickup_longitude / 0.05) * 0.05 AS zone_longitude,
			COUNT(*) AS ride_count,
			COALESCE(AVG(surge_multiplier), 1.0) AS avg_surge
		`).
		Where("created_at >= ? AND created_at <= ? AND pickup_latitude IS NOT NULL AND pickup_longitude IS NOT NULL", startDate, endDate).
		Group("zone_latitude, zone_longitude").
		Having("COUNT(*) >= ?", minRides).
		Order("ride_count DESC").
		Limit(20).
		Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get demand zones: %w", err)
	}

	type hourRow struct {
		ZoneLatitude  float64
		ZoneLongitude float64
		Hour          int
		HourCount     int64
	}
	var hourRows []hourRow
	if len(rows) > 0 {
		err = r.db.GetReplica().WithContext(ctx).
			Model(&models.Ride{}).
			Select(`
				ROUND(pickup_latitude / 0.05) * 0.05  AS zone_latitude,
				ROUND(pickup_longitude / 0.05) * 0.05 AS zone_longitude,
				EXTRACT(HOUR FROM requested_at)::int AS hour,
				COUNT(*) AS hour_count
			`).
			Where("created_at >= ? AND created_at <= ? AND pickup_latitude IS NOT NULL AND pickup_longitude IS NOT NULL", startDate, endDate).
			Group("zone_latitude, zone_longitude, hour").
			Order("zone_latitude, zone_longitude, hour_count DESC").
			Scan(&hourRows).Error
		if err != nil {
			return nil, fmt.Errorf("failed to get demand zone hours: %w", err)
		}
	}

	type zoneKey struct{ lat, lng float64 }
	peakHoursMap := make(map[zoneKey][]string)
	for _, hr := range hourRows {
		k := zoneKey{hr.ZoneLatitude, hr.ZoneLongitude}
		if len(peakHoursMap[k]) < 3 {
			peakHoursMap[k] = append(peakHoursMap[k], fmt.Sprintf("%02d:00", hr.Hour))
		}
	}

	results := make([]*analyticsModels.DemandZone, 0, len(rows))
	for i, row := range rows {
		k := zoneKey{row.ZoneLatitude, row.ZoneLongitude}
		zone := &analyticsModels.DemandZone{
			ZoneName:        fmt.Sprintf("Zone %d", i+1),
			CenterLatitude:  row.ZoneLatitude,
			CenterLongitude: row.ZoneLongitude,
			TotalRides:      int(row.RideCount),
			AvgSurge:        row.AvgSurge,
			RadiusKm:        5.0,
			PeakHours:       fmt.Sprintf("%v", peakHoursMap[k]),
		}
		results = append(results, zone)
	}
	return results, nil
}

func (r *Repository) GetRevenueTimeSeries(ctx context.Context, startDate, endDate time.Time, granularity string) ([]*analyticsModels.RevenueTimeSeries, error) {
	var dateExpr, groupExpr string
	switch granularity {
	case "week":
		dateExpr = "TO_CHAR(DATE_TRUNC('week', completed_at), 'YYYY-WW')"
		groupExpr = "DATE_TRUNC('week', completed_at)"
	case "month":
		dateExpr = "TO_CHAR(DATE_TRUNC('month', completed_at), 'YYYY-MM')"
		groupExpr = "DATE_TRUNC('month', completed_at)"
	default:
		dateExpr = "TO_CHAR(DATE(completed_at), 'YYYY-MM-DD')"
		groupExpr = "DATE(completed_at)"
	}

	type result struct {
		Date    string
		Revenue float64
		Rides   int64
		AvgFare float64
	}

	var rows []result
	err := r.db.GetReplica().WithContext(ctx).
		Model(&models.Ride{}).
		Select(fmt.Sprintf(`
			%s AS date,
			COALESCE(SUM(final_fare), 0) AS revenue,
			COUNT(*) AS rides,
			COALESCE(AVG(final_fare), 0) AS avg_fare
		`, dateExpr)).
		Where("status = 'completed' AND completed_at >= ? AND completed_at <= ?", startDate, endDate).
		Group(groupExpr).
		Order(groupExpr + " ASC").
		Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get revenue timeseries: %w", err)
	}

	results := make([]*analyticsModels.RevenueTimeSeries, 0, len(rows))
	for _, row := range rows {
		results = append(results, &analyticsModels.RevenueTimeSeries{
			Date:    row.Date,
			Revenue: row.Revenue,
			Rides:   int(row.Rides),
			AvgFare: row.AvgFare,
		})
	}
	return results, nil
}

func (r *Repository) GetHourlyDistribution(ctx context.Context, startDate, endDate time.Time) ([]*analyticsModels.HourlyDistribution, error) {
	type result struct {
		Hour        int
		Rides       int64
		AvgFare     float64
		AvgWaitTime float64
	}

	var rows []result
	err := r.db.GetReplica().WithContext(ctx).
		Model(&models.Ride{}).
		Select(`
			EXTRACT(HOUR FROM requested_at)::int AS hour,
			COUNT(*) AS rides,
			COALESCE(AVG(final_fare), 0) AS avg_fare,
			COALESCE(AVG(EXTRACT(EPOCH FROM (accepted_at - requested_at)) / 60), 0) AS avg_wait_time
		`).
		Where("created_at >= ? AND created_at <= ?", startDate, endDate).
		Group("hour").
		Order("hour ASC").
		Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get hourly distribution: %w", err)
	}

	results := make([]*analyticsModels.HourlyDistribution, 0, len(rows))
	for _, row := range rows {
		results = append(results, &analyticsModels.HourlyDistribution{
			Hour:        row.Hour,
			Rides:       int(row.Rides),
			AvgFare:     row.AvgFare,
			AvgWaitTime: row.AvgWaitTime,
		})
	}
	return results, nil
}

func (r *Repository) GetDriverAnalytics(ctx context.Context, startDate, endDate time.Time) (*analyticsModels.DriverAnalytics, error) {
	analytics := &analyticsModels.DriverAnalytics{}

	type driverResult struct {
		TotalActiveDrivers int64
		AvgRidesPerDriver  float64
		AvgRating          float64
	}
	var dr driverResult
	err := r.db.GetReplica().WithContext(ctx).
		Table("users u").
		Select(`
			COUNT(DISTINCT u.id) AS total_active_drivers,
			COALESCE(COUNT(r.id)::float / NULLIF(COUNT(DISTINCT u.id), 0), 0) AS avg_rides_per_driver,
			COALESCE(AVG(r.rating), 0) AS avg_rating
		`).
		Joins("LEFT JOIN rides r ON u.id = r.driver_id AND r.created_at >= ? AND r.created_at <= ?", startDate, endDate).
		Where("u.role = ? AND u.is_active = true", "driver").
		Scan(&dr).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get driver analytics: %w", err)
	}
	analytics.TotalActiveDrivers = int(dr.TotalActiveDrivers)
	analytics.AvgRidesPerDriver = dr.AvgRidesPerDriver
	analytics.AvgRating = dr.AvgRating

	type rateResult struct {
		CancellationRate float64
		AcceptanceRate   float64
	}
	var rr rateResult
	if err = r.db.GetReplica().WithContext(ctx).
		Model(&models.Ride{}).
		Select(`
			COALESCE(COUNT(*) FILTER (WHERE status = 'cancelled')::float / NULLIF(COUNT(*), 0) * 100, 0) AS cancellation_rate,
			COALESCE(COUNT(*) FILTER (WHERE status IN ('accepted','in_progress','completed'))::float / NULLIF(COUNT(*), 0) * 100, 0) AS acceptance_rate
		`).
		Where("driver_id IS NOT NULL AND created_at >= ? AND created_at <= ?", startDate, endDate).
		Scan(&rr).Error; err != nil {
		return nil, fmt.Errorf("failed to get driver rate metrics: %w", err)
	}
	analytics.AvgCancellationRate = rr.CancellationRate
	analytics.AvgAcceptanceRate = rr.AcceptanceRate

	var newDriversCount int64
	if err = r.db.GetReplica().WithContext(ctx).
		Model(&models.User{}).
		Where("role = ? AND created_at >= ? AND created_at <= ?", "driver", startDate, endDate).
		Count(&newDriversCount).Error; err != nil {
		return nil, fmt.Errorf("failed to count new drivers: %w", err)
	}
	analytics.NewDrivers = int(newDriversCount)

	return analytics, nil
}

func (r *Repository) GetRiderGrowth(ctx context.Context, startDate, endDate time.Time) (*analyticsModels.RiderGrowth, error) {
	growth := &analyticsModels.RiderGrowth{}
	today := time.Now().Truncate(24 * time.Hour)

	var newRidersCount int64
	if err := r.db.GetReplica().WithContext(ctx).Model(&models.User{}).
		Where("role = 'rider' AND created_at >= ? AND created_at <= ?", startDate, endDate).
		Count(&newRidersCount).Error; err != nil {
		return nil, fmt.Errorf("failed to count new riders: %w", err)
	}
	growth.NewRiders = int(newRidersCount)

	var returningRiders int
	if err := r.db.GetReplica().WithContext(ctx).
		Model(&models.Ride{}).
		Select("COUNT(*) AS returning_riders").
		Where(`rider_id IN (
			SELECT rider_id FROM rides
			WHERE created_at >= ? AND created_at <= ?
			GROUP BY rider_id
			HAVING COUNT(*) > 1
		)`, startDate, endDate).
		Scan(&returningRiders).Error; err != nil {
		return nil, fmt.Errorf("failed to count returning riders: %w", err)
	}
	growth.ReturningRiders = returningRiders

	type avgResult struct{ Avg float64 }
	var avgRes avgResult
	if err := r.db.GetReplica().WithContext(ctx).
		Model(&models.Ride{}).
		Select("COALESCE(COUNT(*)::float / NULLIF(COUNT(DISTINCT rider_id), 0), 0) AS avg").
		Where("created_at >= ? AND created_at <= ?", startDate, endDate).
		Scan(&avgRes).Error; err != nil {
		return nil, fmt.Errorf("failed to calculate avg rides per rider: %w", err)
	}
	growth.AvgRidesPerRider = avgRes.Avg

	var firstTimeRidersToday int64
	if err := r.db.GetReplica().WithContext(ctx).Model(&models.User{}).
		Where("role = 'rider' AND created_at >= ?", today).
		Count(&firstTimeRidersToday).Error; err != nil {
		return nil, fmt.Errorf("failed to count first time riders: %w", err)
	}
	growth.FirstTimeRidersToday = int(firstTimeRidersToday)

	var totalRiders int64
	if err := r.db.GetReplica().WithContext(ctx).Model(&models.User{}).
		Where("role = 'rider' AND is_active = true").
		Count(&totalRiders).Error; err != nil {
		return nil, fmt.Errorf("failed to count active riders: %w", err)
	}
	if totalRiders > 0 {
		growth.RetentionRate = float64(growth.ReturningRiders) / float64(totalRiders) * 100
	}

	type ltvResult struct{ Ltv float64 }
	var ltvRes ltvResult
	if err := r.db.GetReplica().WithContext(ctx).
		Model(&models.Ride{}).
		Select("COALESCE(SUM(final_fare) / NULLIF(COUNT(DISTINCT rider_id), 0), 0) AS ltv").
		Where("status = 'completed'").
		Scan(&ltvRes).Error; err != nil {
		return nil, fmt.Errorf("failed to calculate lifetime value: %w", err)
	}
	growth.LifetimeValueAvg = ltvRes.Ltv

	return growth, nil
}

func (r *Repository) GetRideMetrics(ctx context.Context, startDate, endDate time.Time) (*analyticsModels.RideMetrics, error) {
	metrics := &analyticsModels.RideMetrics{}

	err := r.db.GetReplica().WithContext(ctx).
		Model(&models.Ride{}).
		Select(`
			COALESCE(AVG(EXTRACT(EPOCH FROM (accepted_at - requested_at)) / 60) FILTER (WHERE accepted_at IS NOT NULL), 0) AS avg_wait_time_minutes,
			COALESCE(AVG(actual_duration) FILTER (WHERE actual_duration IS NOT NULL), 0) AS avg_ride_duration_minutes,
			COALESCE(AVG(actual_distance) FILTER (WHERE actual_distance IS NOT NULL), 0) AS avg_distance_km,
			COALESCE(COUNT(*) FILTER (WHERE status = 'cancelled')::float / NULLIF(COUNT(*), 0) * 100, 0) AS cancellation_rate,
			COALESCE(COUNT(*) FILTER (WHERE status = 'cancelled' AND cancellation_reason LIKE '%rider%')::float / NULLIF(COUNT(*), 0) * 100, 0) AS rider_cancellation_rate,
			COALESCE(COUNT(*) FILTER (WHERE status = 'cancelled' AND cancellation_reason LIKE '%driver%')::float / NULLIF(COUNT(*), 0) * 100, 0) AS driver_cancellation_rate,
			COALESCE(COUNT(*) FILTER (WHERE surge_multiplier > 1.0)::float / NULLIF(COUNT(*), 0) * 100, 0) AS surge_rides_percentage,
			COALESCE(AVG(surge_multiplier) FILTER (WHERE surge_multiplier > 1.0), 1.0) AS avg_surge_multiplier
		`).
		Where("created_at >= ? AND created_at <= ?", startDate, endDate).
		Scan(metrics).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get ride metrics: %w", err)
	}
	return metrics, nil
}

func (r *Repository) GetTopDriversDetailed(ctx context.Context, startDate, endDate time.Time, limit int) ([]*analyticsModels.TopDriver, error) {
	type result struct {
		DriverID       uuid.UUID
		Name           string
		TotalRides     int
		TotalRevenue   float64
		AvgRating      float64
		AcceptanceRate float64
		OnlineHours    float64
	}

	var rows []result
	err := r.db.GetReplica().WithContext(ctx).
		Table("drivers d").
		Select(`
			d.id AS driver_id,
			COALESCE(u.first_name || ' ' || u.last_name, u.email) AS name,
			COUNT(r.id) AS total_rides,
			COALESCE(SUM(r.final_fare), 0) AS total_revenue,
			COALESCE(d.rating, 0) AS avg_rating,
			COALESCE(COUNT(*) FILTER (WHERE r.status IN ('accepted','in_progress','completed'))::float / NULLIF(COUNT(*), 0) * 100, 0) AS acceptance_rate,
			COALESCE(d.total_rides::float * 0.5, 0) AS online_hours
		`).
		Joins("JOIN users u ON d.user_id = u.id").
		Joins("LEFT JOIN rides r ON d.id = r.driver_id AND r.created_at >= ? AND r.created_at <= ?", startDate, endDate).
		Group("d.id, u.first_name, u.last_name, u.email, d.rating, d.total_rides").
		Having("COUNT(r.id) > 0").
		Order("total_revenue DESC").
		Limit(limit).
		Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get top drivers: %w", err)
	}

	results := make([]*analyticsModels.TopDriver, 0, len(rows))
	for _, row := range rows {
		results = append(results, &analyticsModels.TopDriver{
			DriverID:       row.DriverID,
			Name:           row.Name,
			TotalRides:     row.TotalRides,
			TotalRevenue:   row.TotalRevenue,
			AvgRating:      row.AvgRating,
			AcceptanceRate: row.AcceptanceRate,
			OnlineHours:    row.OnlineHours,
		})
	}
	return results, nil
}

func (r *Repository) GetPeriodComparison(ctx context.Context, currentStart, currentEnd, previousStart, previousEnd time.Time) (*analyticsModels.PeriodComparison, error) {
	type periodResult struct {
		Revenue   float64
		Rides     int64
		AvgRating float64
	}

	scanPeriod := func(start, end time.Time) (periodResult, error) {
		var pr periodResult
		err := r.db.GetReplica().WithContext(ctx).
			Model(&models.Ride{}).
			Select("COALESCE(SUM(final_fare), 0) AS revenue, COUNT(*) AS rides, COALESCE(AVG(rating), 0) AS avg_rating").
			Where("status = 'completed' AND completed_at >= ? AND completed_at <= ?", start, end).
			Scan(&pr).Error
		return pr, err
	}

	countNewRiders := func(start, end time.Time) (int64, error) {
		var count int64
		err := r.db.GetReplica().WithContext(ctx).Model(&models.User{}).
			Where("role = 'rider' AND created_at >= ? AND created_at <= ?", start, end).
			Count(&count).Error
		return count, err
	}

	cur, err := scanPeriod(currentStart, currentEnd)
	if err != nil {
		return nil, fmt.Errorf("failed to get current period metrics: %w", err)
	}
	prev, err := scanPeriod(previousStart, previousEnd)
	if err != nil {
		return nil, fmt.Errorf("failed to get previous period metrics: %w", err)
	}

	curNewRiders, err := countNewRiders(currentStart, currentEnd)
	if err != nil {
		return nil, fmt.Errorf("failed to count current period new riders: %w", err)
	}
	prevNewRiders, err := countNewRiders(previousStart, previousEnd)
	if err != nil {
		return nil, fmt.Errorf("failed to count previous period new riders: %w", err)
	}

	comparison := &analyticsModels.PeriodComparison{
		Revenue: analyticsModels.ComparisonMetric{
			Current:       cur.Revenue,
			Previous:      prev.Revenue,
			ChangePercent: calculateChangePercent(cur.Revenue, prev.Revenue),
		},
		Rides: analyticsModels.ComparisonMetric{
			Current:       float64(cur.Rides),
			Previous:      float64(prev.Rides),
			ChangePercent: calculateChangePercent(float64(cur.Rides), float64(prev.Rides)),
		},
		NewRiders: analyticsModels.ComparisonMetric{
			Current:       float64(curNewRiders),
			Previous:      float64(prevNewRiders),
			ChangePercent: calculateChangePercent(float64(curNewRiders), float64(prevNewRiders)),
		},
		AvgRating: analyticsModels.ComparisonMetric{
			Current:       cur.AvgRating,
			Previous:      prev.AvgRating,
			ChangePercent: calculateChangePercent(cur.AvgRating, prev.AvgRating),
		},
	}
	return comparison, nil
}

func calculateChangePercent(current, previous float64) float64 {
	if previous == 0 {
		if current > 0 {
			return 100
		}
		return 0
	}
	return ((current - previous) / previous) * 100
}
