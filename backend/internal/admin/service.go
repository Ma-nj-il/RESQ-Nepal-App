package admin

import (
	"context"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/models"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

type Service struct {
	repo   RepositoryInterface
	logger *zap.Logger
}

func NewService(repo RepositoryInterface, logger *zap.Logger) *Service {
	return &Service{repo: repo,
		logger: logger}
}

func (s *Service) GetAllUsers(ctx context.Context, limit, offset int, filter *UserFilter) ([]*models.User, int, error) {
	s.logger.Info("Fetching all users")
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}

	if filter != nil && filter.Role != "" {
		validRoles := map[string]bool{"admin": true, "driver": true, "rider": true}
		if !validRoles[filter.Role] {
			filter.Role = ""
		}
	}

	return s.repo.GetAllUsers(ctx, limit, offset, filter)
}

func (s *Service) GetUserStats(ctx context.Context) (*UserStats, error) {
	s.logger.Info("Fetching user stats")
	return s.repo.GetUserStats(ctx)
}

func (s *Service) GetUser(ctx context.Context, userID uuid.UUID) (*models.User, error) {
	s.logger.Info("Fetching user detail",
		zap.String("user_id", userID.String()),
	)
	return s.repo.GetUserByID(ctx, userID)
}

func (s *Service) SuspendUser(ctx context.Context, adminID, userID uuid.UUID) error {
	s.logger.Info("Suspending user",
		zap.String("admin_id", adminID.String()),
		zap.String("user_id", userID.String()),
	)

	if err := s.repo.UpdateUserStatus(ctx, userID, false); err != nil {
		s.logger.Error("Failed to suspend user",
			zap.String("admin_id", adminID.String()),
			zap.String("user_id", userID.String()),
			zap.Error(err),
		)
		return err
	}
	s.repo.InsertAuditLog(ctx, adminID, "suspend_user", "user", userID, nil)
	s.logger.Info("User suspended successfully",
		zap.String("admin_id", adminID.String()),
		zap.String("user_id", userID.String()),
	)
	return nil
}

func (s *Service) ActivateUser(ctx context.Context, adminID, userID uuid.UUID) error {
	s.logger.Info("Activating user",
		zap.String("admin_id", adminID.String()),
		zap.String("user_id", userID.String()))
	if err := s.repo.UpdateUserStatus(ctx, userID, true); err != nil {
		s.logger.Error("Failed to activate user")
		return err
	}
	s.repo.InsertAuditLog(ctx, adminID, "activate_user", "user", userID, nil)
	return nil
}

func (s *Service) GetAllDrivers(ctx context.Context, limit, offset int, filter *DriverFilter) ([]*models.Driver, int64, error) {
	s.logger.Info("Fetching all the drivers")
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}

	if filter != nil && filter.Status != "" {
		validStatuses := map[string]bool{"online": true, "offline": true, "available": true, "pending": true}
		if !validStatuses[filter.Status] {
			filter.Status = ""
		}
	}

	return s.repo.GetAllDriversWithTotal(ctx, limit, offset, filter)
}

func (s *Service) GetDriverStats(ctx context.Context) (*DriverStats, error) {
	s.logger.Info("Fetching driver stats")
	return s.repo.GetDriverStats(ctx)
}

func (s *Service) GetPendingDrivers(ctx context.Context, limit, offset int) ([]*models.Driver, int64, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}

	return s.repo.GetPendingDriversWithTotal(ctx, limit, offset)
}

func (s *Service) GetDriver(ctx context.Context, driverID uuid.UUID) (*models.Driver, error) {
	s.logger.Info("Fetching rider detail",
		zap.String("driver_id", driverID.String()))
	return s.repo.GetDriverByID(ctx, driverID)
}

func (s *Service) ApproveDriver(ctx context.Context, adminID, driverID uuid.UUID) error {
	s.logger.Info("Approving driver",
		zap.String("admin_id", adminID.String()),
		zap.String("driver_id", driverID.String()))

	if err := s.repo.ApproveDriver(ctx, driverID); err != nil {
		s.logger.Error("Failed to approve driver")
		return err
	}
	s.repo.InsertAuditLog(ctx, adminID, "approve_driver", "driver", driverID, nil)
	return nil
}

func (s *Service) RejectDriver(ctx context.Context, adminID, driverID uuid.UUID) error {
	s.logger.Info("Rejecting driver ",
		zap.String("admin_id", adminID.String()),
		zap.String("driver_id", driverID.String()))

	if err := s.repo.RejectDriver(ctx, driverID); err != nil {
		s.logger.Error("Failed to reject driver")
		return err
	}
	s.repo.InsertAuditLog(ctx, adminID, "reject_driver", "driver", driverID, nil)
	return nil
}

func (s *Service) GetDashboardStats(ctx context.Context) (*DashboardStats, error) {
	s.logger.Info("Fetching Dashboard stats")
	userStats, err := s.repo.GetUserStats(ctx)
	if err != nil {
		s.logger.Error("Failed to fetch dashboard stats")
		return nil, err
	}

	rideStats, err := s.repo.GetRideStats(ctx, nil, nil)
	if err != nil {
		return nil, err
	}
	today := time.Now().Truncate(24 * time.Hour)
	todayStats, err := s.repo.GetRideStats(ctx, &today, nil)
	if err != nil {
		return nil, err
	}

	return &DashboardStats{
		Users:      userStats,
		Rides:      rideStats,
		TodayRides: todayStats,
	}, nil
}

func (s *Service) GetRideStats(ctx context.Context, startDate, endDate *time.Time) (*RideStats, error) {
	s.logger.Info("Fetching ride stats",
		zap.Any("start_time", startDate),
		zap.Any("end_time", endDate),
	)
	return s.repo.GetRideStats(ctx, startDate, endDate)
}

func (s *Service) GetRide(ctx context.Context, rideID uuid.UUID) (*AdminRideDetail, error) {
	s.logger.Info("Fetching Ride",
		zap.String("ride_id", rideID.String()))

	return s.repo.GetRideByID(ctx, rideID)
}

func (s *Service) GetRecentRides(ctx context.Context, limit, offset int) ([]*AdminRideDetail, int64, error) {
	s.logger.Info("Fetching recent rides")
	if limit <= 0 || limit > 100 {
		limit = 50
	}

	return s.repo.GetRecentRidesWithDetails(ctx, limit, offset)
}

func (s *Service) GetRealtimeMetrics(ctx context.Context) (*RealtimeMetrics, error) {
	s.logger.Info("Fetching realtime metrics")
	return s.repo.GetRealtimeMetrics(ctx)
}

func (s *Service) GetDashboardSummary(ctx context.Context, period string) (*DashboardSummary, error) {
	s.logger.Info("Fetching dashboard summary")
	return s.repo.GetDashboardSummary(ctx, period)
}

func (s *Service) GetRevenueTrend(ctx context.Context, period, groupBy string) (*RevenueTrend, error) {
	s.logger.Info("Fetching revenue trend")
	return s.repo.GetRevenueTrend(ctx, period, groupBy)
}

func (s *Service) GetActionItems(ctx context.Context) (*ActionItems, error) {
	return s.repo.GetActionItems(ctx)
}

func (s *Service) GetAuditLogs(ctx context.Context, limit, offset int, filter *AuditLogFilter) ([]*AuditLog, int64, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	return s.repo.GetAuditLogs(ctx, limit, offset, filter)
}
