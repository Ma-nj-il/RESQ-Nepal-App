package documents

import (
	"context"
	"time"

	"github.com/google/uuid"
)

type RepositoryInterface interface {
	GetDocumentTypes(ctx context.Context) ([]*DocumentType, error)
	GetDocumentTypeByCode(ctx context.Context, code string) (*DocumentType, error)
	GetRequiredDocumentTypes(ctx context.Context) ([]*DocumentType, error)

	CreateDocument(ctx context.Context, doc *DriverDocument) error
	GetDocument(ctx context.Context, documentID uuid.UUID) (*DriverDocument, error)
	GetDriverDocuments(ctx context.Context, driverID uuid.UUID) ([]*DriverDocument, error)
	GetLatestDocumentByType(ctx context.Context, driverID, documentTypeID uuid.UUID) (*DriverDocument, error)
	UpdateDocumentStatus(ctx context.Context, documentID uuid.UUID, status DocumentStatus, reviewedBy *uuid.UUID, reviewNotes, rejectionReason *string) error
	UpdateDocumentOCRData(ctx context.Context, documentID uuid.UUID, ocrData map[string]interface{}, confidence float64) error
	UpdateDocumentDetails(ctx context.Context, documentID uuid.UUID, documentNumber *string, issueDate, expiryDate *time.Time, issuingAuthority *string) error
	SupersedeDocument(ctx context.Context, documentID uuid.UUID) error
	UpdateDocumentBackFile(ctx context.Context, documentID uuid.UUID, backFileURL, backFileKey string) error

	GetDriverVerificationStatus(ctx context.Context, driverID uuid.UUID) (*DriverVerificationStatus, error)

	GetPendingReviews(ctx context.Context, limit, offset int) ([]*PendingReviewDocument, int, error)
	GetExpiringDocuments(ctx context.Context, daysAhead int) ([]*ExpiringDocument, error)

	CreateHistory(ctx context.Context, history *DocumentVerificationHistory) error
	GetDocumentHistory(ctx context.Context, documentID uuid.UUID) ([]*DocumentVerificationHistory, error)

	CreateOCRJob(ctx context.Context, job *OCRProcessingQueue) error
	GetPendingOCRJobs(ctx context.Context, limit int) ([]*OCRProcessingQueue, error)
	UpdateOCRJobStatus(ctx context.Context, jobID uuid.UUID, status string, result, errorMsg *string) error
	CompleteOCRJob(ctx context.Context, jobID uuid.UUID, extractedData map[string]interface{}, confidence float64, processingTimeMs int) error
	FailOCRJob(ctx context.Context, jobID uuid.UUID, errorMessage string) error
	UpdateOCRJobRetry(ctx context.Context, jobID uuid.UUID, retryCount int, nextRetry time.Time) error
}

var _ RepositoryInterface = (*Repository)(nil)
