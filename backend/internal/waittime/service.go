package waittime

import (
	"context"
	"math"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/common"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

const (
	defaultFreeMinutes    = 3
	defaultChargePerMin   = 0.25
	defaultMaxWaitMinutes = 15
	defaultMaxWaitCharge  = 10.0
)

type Service struct {
	repo RepositoryInterface
}

func NewService(repo RepositoryInterface) *Service {
	return &Service{repo: repo}
}

func (s *Service) StartWait(ctx context.Context, driverID uuid.UUID, req *StartWaitRequest) (*WaitTimeRecord, error) {
	existing, err := s.repo.GetActiveWaitByRide(ctx, req.RideID)
	if err != nil && err != gorm.ErrRecordNotFound {
		return nil, err
	}
	if existing != nil {
		return nil, common.NewConflictError("wait timer already active for this ride")
	}

	config, err := s.repo.GetActiveConfig(ctx)
	if err != nil {
		config = &WaitTimeConfig{
			ID:              uuid.New(),
			FreeWaitMinutes: defaultFreeMinutes,
			ChargePerMinute: defaultChargePerMin,
			MaxWaitMinutes:  defaultMaxWaitMinutes,
			MaxWaitCharge:   defaultMaxWaitCharge,
		}
	}

	now := time.Now()
	record := &WaitTimeRecord{
		ID:              uuid.New(),
		RideID:          req.RideID,
		DriverID:        driverID,
		ConfigID:        config.ID,
		WaitType:        req.WaitType,
		ArrivedAt:       now,
		FreeMinutes:     config.FreeWaitMinutes,
		ChargePerMinute: config.ChargePerMinute,
		Status:          "waiting",
		CreatedAt:       now,
		UpdatedAt:       now,
	}

	if err := s.repo.CreateRecord(ctx, record); err != nil {
		return nil, err
	}

	return record, nil
}

func (s *Service) StopWait(ctx context.Context, driverID uuid.UUID, req *StopWaitRequest) (*WaitTimeRecord, error) {
	record, err := s.repo.GetActiveWaitByRide(ctx, req.RideID)
	if err != nil {
		return nil, err
	}
	if record == nil {
		return nil, common.NewNotFoundError("no active wait timer for this ride", nil)
	}

	if record.DriverID != driverID {
		return nil, common.NewForbiddenError("not your ride")
	}

	now := time.Now()
	totalWaitMin := now.Sub(record.ArrivedAt).Minutes()
	chargeableMin := math.Max(0, totalWaitMin-float64(record.FreeMinutes))
	totalCharge := chargeableMin * record.ChargePerMinute

	config, _ := s.repo.GetActiveConfig(ctx)
	maxCharge := defaultMaxWaitCharge
	if config != nil {
		maxCharge = config.MaxWaitCharge
	}

	wasCapped := false
	if totalCharge > maxCharge {
		totalCharge = maxCharge
		wasCapped = true
	}

	totalCharge = math.Round(totalCharge*100) / 100
	chargeableMin = math.Round(chargeableMin*100) / 100
	totalWaitMin = math.Round(totalWaitMin*100) / 100

	if err := s.repo.CompleteWait(ctx, record.ID, totalWaitMin, chargeableMin, totalCharge, wasCapped); err != nil {
		return nil, err
	}

	record.TotalWaitMinutes = totalWaitMin
	record.ChargeableMinutes = chargeableMin
	record.TotalCharge = totalCharge
	record.WasCapped = wasCapped
	record.Status = "completed"
	record.StartedAt = &now

	return record, nil
}

func (s *Service) GetWaitTimeSummary(ctx context.Context, rideID uuid.UUID) (*WaitTimeSummary, error) {
	records, err := s.repo.GetRecordsByRide(ctx, rideID)
	if err != nil {
		return nil, err
	}
	if records == nil {
		records = []WaitTimeRecord{}
	}

	summary := &WaitTimeSummary{
		RideID:  rideID,
		Records: records,
	}

	for _, rec := range records {
		summary.TotalWaitMinutes += rec.TotalWaitMinutes
		summary.TotalChargeableMin += rec.ChargeableMinutes
		summary.TotalCharge += rec.TotalCharge
		if rec.Status == "waiting" {
			summary.HasActiveWait = true
		}
	}

	return summary, nil
}

func (s *Service) GetCurrentWaitStatus(ctx context.Context, rideID uuid.UUID) (*WaitTimeRecord, error) {
	record, err := s.repo.GetActiveWaitByRide(ctx, rideID)
	if err != nil {
		return nil, err
	}
	if record == nil {
		return nil, common.NewNotFoundError("no active wait timer", nil)
	}

	now := time.Now()
	totalWaitMin := now.Sub(record.ArrivedAt).Minutes()
	chargeableMin := math.Max(0, totalWaitMin-float64(record.FreeMinutes))
	totalCharge := chargeableMin * record.ChargePerMinute

	config, _ := s.repo.GetActiveConfig(ctx)
	maxCharge := defaultMaxWaitCharge
	if config != nil {
		maxCharge = config.MaxWaitCharge
	}
	if totalCharge > maxCharge {
		totalCharge = maxCharge
		record.WasCapped = true
	}

	record.TotalWaitMinutes = math.Round(totalWaitMin*100) / 100
	record.ChargeableMinutes = math.Round(chargeableMin*100) / 100
	record.TotalCharge = math.Round(totalCharge*100) / 100

	return record, nil
}

func (s *Service) WaiveCharge(ctx context.Context, recordID uuid.UUID) error {
	return s.repo.WaiveCharge(ctx, recordID)
}

func (s *Service) CreateConfig(ctx context.Context, req *CreateConfigRequest) (*WaitTimeConfig, error) {
	now := time.Now()
	config := &WaitTimeConfig{
		ID:              uuid.New(),
		Name:            req.Name,
		FreeWaitMinutes: req.FreeWaitMinutes,
		ChargePerMinute: req.ChargePerMinute,
		MaxWaitMinutes:  req.MaxWaitMinutes,
		MaxWaitCharge:   req.MaxWaitCharge,
		AppliesTo:       req.AppliesTo,
		IsActive:        true,
		CreatedAt:       now,
		UpdatedAt:       now,
	}

	if err := s.repo.CreateConfig(ctx, config); err != nil {
		return nil, err
	}
	return config, nil
}

func (s *Service) ListConfigs(ctx context.Context) ([]WaitTimeConfig, error) {
	configs, err := s.repo.GetAllConfigs(ctx)
	if err != nil {
		return nil, err
	}
	if configs == nil {
		configs = []WaitTimeConfig{}
	}
	return configs, nil
}

func (s *Service) GetTotalWaitCharge(ctx context.Context, rideID uuid.UUID) (float64, error) {
	records, err := s.repo.GetRecordsByRide(ctx, rideID)
	if err != nil {
		return 0, err
	}

	total := 0.0
	for _, rec := range records {
		if rec.Status == "completed" {
			total += rec.TotalCharge
		}
	}
	return total, nil
}
