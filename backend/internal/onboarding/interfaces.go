package onboarding

import (
	"context"

	"github.com/google/uuid"
)

type RepositoryInterface interface {
	GetDriver(ctx context.Context, driverID uuid.UUID) (*DriverInfo, error)
	GetDriverByUserID(ctx context.Context, userID uuid.UUID) (*DriverInfo, error)
	CreateDriver(ctx context.Context, userID uuid.UUID) (uuid.UUID, error)

	GetBackgroundCheck(ctx context.Context, driverID uuid.UUID) (*BackgroundCheck, error)
	CreateBackgroundCheck(ctx context.Context, driverID uuid.UUID, provider string) (*BackgroundCheck, error)
	UpdateBackgroundCheckStatus(ctx context.Context, checkID uuid.UUID, status string, notes *string) error

	ApproveDriver(ctx context.Context, driverID uuid.UUID, approvedBy uuid.UUID) error
	RejectDriver(ctx context.Context, driverID uuid.UUID, rejectedBy uuid.UUID, reason string) error

	GetOnboardingStats(ctx context.Context) (*OnboardingStats, error)
}
