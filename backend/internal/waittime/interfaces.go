package waittime

import (
	"context"

	"github.com/google/uuid"
)

type RepositoryInterface interface {
	// Configs
	GetActiveConfig(ctx context.Context) (*WaitTimeConfig, error)
	GetAllConfigs(ctx context.Context) ([]WaitTimeConfig, error)
	CreateConfig(ctx context.Context, config *WaitTimeConfig) error

	CreateRecord(ctx context.Context, rec *WaitTimeRecord) error
	GetActiveWaitByRide(ctx context.Context, rideID uuid.UUID) (*WaitTimeRecord, error)
	CompleteWait(ctx context.Context, recordID uuid.UUID, totalWaitMin, chargeableMin, totalCharge float64, wasCapped bool) error
	WaiveCharge(ctx context.Context, recordID uuid.UUID) error
	GetRecordsByRide(ctx context.Context, rideID uuid.UUID) ([]WaitTimeRecord, error)

	SaveNotification(ctx context.Context, n *WaitTimeNotification) error
}
