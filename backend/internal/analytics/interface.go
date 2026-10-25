package analytics

import (
	"context"
	"time"

	"github.com/bikky-kc013/medi-ambulance/internal/analytics/models"
)

type AnalyticsRepository interface {
	GetRevenueMetrics(ctx context.Context, startDate, endDate time.Time) (*models.RevenueMetrics, error)
	GetRideTypeStats(ctx context.Context, startDate, endDate time.Time) ([]*models.RideTypeStats, error)
	GetTopDrivers(ctx context.Context, startDate, endDate time.Time, limit int) ([]*models.DriverPerformance, error)
	GetDashboardMetrics(ctx context.Context) (*models.DashboardMetrics, error)
	GetDemandHeatMap(ctx context.Context, startDate, endDate time.Time, gridSize float64) ([]*models.DemandHeatMap, error)
	GetFinancialReport(ctx context.Context, startDate, endDate time.Time) (*models.FinancialReport, error)
	GetDemandZones(ctx context.Context, startDate, endDate time.Time, minRides int) ([]*models.DemandZone, error)
	GetRevenueTimeSeries(ctx context.Context, startDate, endDate time.Time, granularity string) ([]*models.RevenueTimeSeries, error)
	GetHourlyDistribution(ctx context.Context, startDate, endDate time.Time) ([]*models.HourlyDistribution, error)
	GetDriverAnalytics(ctx context.Context, startDate, endDate time.Time) (*models.DriverAnalytics, error)
	GetRiderGrowth(ctx context.Context, startDate, endDate time.Time) (*models.RiderGrowth, error)
	GetRideMetrics(ctx context.Context, startDate, endDate time.Time) (*models.RideMetrics, error)
	GetTopDriversDetailed(ctx context.Context, startDate, endDate time.Time, limit int) ([]*models.TopDriver, error)
	GetPeriodComparison(ctx context.Context, currentStart, currentEnd, previousStart, previousEnd time.Time) (*models.PeriodComparison, error)
}
