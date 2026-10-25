package analytics

import (
	"context"
	"time"

	analyticsModels "github.com/bikky-kc013/medi-ambulance/internal/analytics/models"
)

type Service struct {
	repo AnalyticsRepository
}

func NewService(repo AnalyticsRepository) *Service {
	return &Service{repo: repo}
}

func (s *Service) GetRevenueMetrics(ctx context.Context, startDate, endDate time.Time) (*analyticsModels.RevenueMetrics, error) {
	return s.repo.GetRevenueMetrics(ctx, startDate, endDate)
}

func (s *Service) GetRideTypeStats(ctx context.Context, startDate, endDate time.Time) ([]*analyticsModels.RideTypeStats, error) {
	return s.repo.GetRideTypeStats(ctx, startDate, endDate)
}

func (s *Service) GetTopDrivers(ctx context.Context, startDate, endDate time.Time, limit int) ([]*analyticsModels.DriverPerformance, error) {
	return s.repo.GetTopDrivers(ctx, startDate, endDate, limit)
}

func (s *Service) GetDashboardMetrics(ctx context.Context) (*analyticsModels.DashboardMetrics, error) {
	return s.repo.GetDashboardMetrics(ctx)
}

func (s *Service) GetDemandHeatMap(ctx context.Context, startDate, endDate time.Time, gridSize float64) ([]*analyticsModels.DemandHeatMap, error) {
	return s.repo.GetDemandHeatMap(ctx, startDate, endDate, gridSize)
}

func (s *Service) GetFinancialReport(ctx context.Context, startDate, endDate time.Time) (*analyticsModels.FinancialReport, error) {
	return s.repo.GetFinancialReport(ctx, startDate, endDate)
}

func (s *Service) GetDemandZones(ctx context.Context, startDate, endDate time.Time, minRides int) ([]*analyticsModels.DemandZone, error) {
	return s.repo.GetDemandZones(ctx, startDate, endDate, minRides)
}

func (s *Service) GetRevenueTimeSeries(ctx context.Context, startDate, endDate time.Time, granularity string) ([]*analyticsModels.RevenueTimeSeries, error) {
	return s.repo.GetRevenueTimeSeries(ctx, startDate, endDate, granularity)
}

func (s *Service) GetHourlyDistribution(ctx context.Context, startDate, endDate time.Time) ([]*analyticsModels.HourlyDistribution, error) {
	return s.repo.GetHourlyDistribution(ctx, startDate, endDate)
}

func (s *Service) GetDriverAnalytics(ctx context.Context, startDate, endDate time.Time) (*analyticsModels.DriverAnalytics, error) {
	return s.repo.GetDriverAnalytics(ctx, startDate, endDate)
}

func (s *Service) GetRiderGrowth(ctx context.Context, startDate, endDate time.Time) (*analyticsModels.RiderGrowth, error) {
	return s.repo.GetRiderGrowth(ctx, startDate, endDate)
}

func (s *Service) GetRideMetrics(ctx context.Context, startDate, endDate time.Time) (*analyticsModels.RideMetrics, error) {
	return s.repo.GetRideMetrics(ctx, startDate, endDate)
}

func (s *Service) GetTopDriversDetailed(ctx context.Context, startDate, endDate time.Time, limit int) ([]*analyticsModels.TopDriver, error) {
	return s.repo.GetTopDriversDetailed(ctx, startDate, endDate, limit)
}

func (s *Service) GetPeriodComparison(ctx context.Context, currentStart, currentEnd, previousStart, previousEnd time.Time) (*analyticsModels.PeriodComparison, error) {
	return s.repo.GetPeriodComparison(ctx, currentStart, currentEnd, previousStart, previousEnd)
}
