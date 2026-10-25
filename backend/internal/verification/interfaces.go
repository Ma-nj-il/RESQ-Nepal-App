package verification

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// RepositoryInterface defines the contract for verification repository operations
type RepositoryInterface interface {
	// Background Check operations
	CreateBackgroundCheck(ctx context.Context, check *BackgroundCheck) error
	GetBackgroundCheck(ctx context.Context, checkID uuid.UUID) (*BackgroundCheck, error)
	GetBackgroundCheckByExternalID(ctx context.Context, provider BackgroundCheckProvider, externalID string) (*BackgroundCheck, error)
	GetLatestBackgroundCheck(ctx context.Context, driverID uuid.UUID) (*BackgroundCheck, error)
	UpdateBackgroundCheckStatus(ctx context.Context, checkID uuid.UUID, status BackgroundCheckStatus, notes *string, failureReasons []string) error
	UpdateBackgroundCheckStarted(ctx context.Context, checkID uuid.UUID, externalID string) error
	UpdateBackgroundCheckCompleted(ctx context.Context, checkID uuid.UUID, status BackgroundCheckStatus, reportURL *string, expiresAt *time.Time) error
	GetPendingBackgroundChecks(ctx context.Context, limit int) ([]*BackgroundCheck, error)

	// Selfie Verification operations
	CreateSelfieVerification(ctx context.Context, verification *SelfieVerification) error
	GetSelfieVerification(ctx context.Context, verificationID uuid.UUID) (*SelfieVerification, error)
	GetLatestSelfieVerification(ctx context.Context, driverID uuid.UUID) (*SelfieVerification, error)
	GetTodaysSelfieVerification(ctx context.Context, driverID uuid.UUID) (*SelfieVerification, error)
	UpdateSelfieVerificationResult(ctx context.Context, verificationID uuid.UUID, status SelfieVerificationStatus, confidenceScore *float64, matchResult *bool, failureReason *string) error
	GetDriverReferencePhoto(ctx context.Context, driverID uuid.UUID) (*string, error)

	// Driver Verification Status
	GetDriverVerificationStatus(ctx context.Context, driverID uuid.UUID) (*DriverVerificationStatus, error)
	UpdateDriverApproval(ctx context.Context, driverID uuid.UUID, approved bool, approvedBy *uuid.UUID, reason *string) error
}

// FaceComparer interface for face comparison operations (allows mocking)
type FaceComparer interface {
	CompareFaces(ctx context.Context, selfieURL, referenceURL string) (confidenceScore float64, match bool, err error)
}

// ProviderInitiator interface for provider-specific check initiation (allows mocking)
type ProviderInitiator interface {
	InitiateCheck(ctx context.Context, req *InitiateBackgroundCheckRequest, checkID uuid.UUID) (externalID string, err error)
}
