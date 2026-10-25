package documents

import (
	"time"

	"github.com/google/uuid"
)

type DocumentStatus string

const (
	StatusPending     DocumentStatus = "pending"
	StatusUnderReview DocumentStatus = "under_review"
	StatusApproved    DocumentStatus = "approved"
	StatusRejected    DocumentStatus = "rejected"
	StatusExpired     DocumentStatus = "expired"
	StatusSuperseded  DocumentStatus = "superseded"
)

type VerificationStatus string

const (
	VerificationIncomplete    VerificationStatus = "incomplete"
	VerificationPendingReview VerificationStatus = "pending_review"
	VerificationApproved      VerificationStatus = "approved"
	VerificationSuspended     VerificationStatus = "suspended"
	VerificationRejected      VerificationStatus = "rejected"
)

type DocumentType struct {
	ID                    uuid.UUID `json:"id" db:"id"`
	Code                  string    `json:"code" db:"code"`
	Name                  string    `json:"name" db:"name"`
	Description           *string   `json:"description" db:"description"`
	IsRequired            bool      `json:"is_required" db:"is_required"`
	RequiresExpiry        bool      `json:"requires_expiry" db:"requires_expiry"`
	RequiresFrontBack     bool      `json:"requires_front_back" db:"requires_front_back"`
	DefaultValidityMonths int       `json:"default_validity_months" db:"default_validity_months"`
	RenewalReminderDays   int       `json:"renewal_reminder_days" db:"renewal_reminder_days"`
	RequiresManualReview  bool      `json:"requires_manual_review" db:"requires_manual_review"`
	AutoOCREnabled        bool      `json:"auto_ocr_enabled" db:"auto_ocr_enabled"`
	CountryCodes          []string  `json:"country_codes" db:"country_codes"`
	DisplayOrder          int       `json:"display_order" db:"display_order"`
	IsActive              bool      `json:"is_active" db:"is_active"`
	CreatedAt             time.Time `json:"created_at" db:"created_at"`
	UpdatedAt             time.Time `json:"updated_at" db:"updated_at"`
}

type DriverDocument struct {
	ID                 uuid.UUID              `json:"id" db:"id"`
	DriverID           uuid.UUID              `json:"driver_id" db:"driver_id"`
	DocumentTypeID     uuid.UUID              `json:"document_type_id" db:"document_type_id"`
	Status             DocumentStatus         `json:"status" db:"status"`
	FileURL            string                 `json:"file_url" db:"file_url"`
	FileKey            string                 `json:"-" db:"file_key"`
	FileName           string                 `json:"file_name" db:"file_name"`
	FileSizeBytes      *int64                 `json:"file_size_bytes" db:"file_size_bytes"`
	FileMimeType       *string                `json:"file_mime_type" db:"file_mime_type"`
	BackFileURL        *string                `json:"back_file_url" db:"back_file_url"`
	BackFileKey        *string                `json:"-" db:"back_file_key"`
	DocumentNumber     *string                `json:"document_number" db:"document_number"`
	IssueDate          *time.Time             `json:"issue_date" db:"issue_date"`
	ExpiryDate         *time.Time             `json:"expiry_date" db:"expiry_date"`
	IssuingAuthority   *string                `json:"issuing_authority" db:"issuing_authority"`
	OCRData            map[string]interface{} `json:"ocr_data" db:"ocr_data"`
	OCRConfidence      *float64               `json:"ocr_confidence" db:"ocr_confidence"`
	OCRProcessedAt     *time.Time             `json:"ocr_processed_at" db:"ocr_processed_at"`
	ReviewedBy         *uuid.UUID             `json:"reviewed_by" db:"reviewed_by"`
	ReviewedAt         *time.Time             `json:"reviewed_at" db:"reviewed_at"`
	ReviewNotes        *string                `json:"review_notes" db:"review_notes"`
	RejectionReason    *string                `json:"rejection_reason" db:"rejection_reason"`
	Version            int                    `json:"version" db:"version"`
	PreviousDocumentID *uuid.UUID             `json:"previous_document_id" db:"previous_document_id"`
	SubmittedAt        time.Time              `json:"submitted_at" db:"submitted_at"`
	CreatedAt          time.Time              `json:"created_at" db:"created_at"`
	UpdatedAt          time.Time              `json:"updated_at" db:"updated_at"`

	DocumentType *DocumentType `json:"document_type,omitempty" db:"-"`
}

type DriverVerificationStatus struct {
	DriverID                   uuid.UUID          `json:"driver_id" db:"driver_id"`
	VerificationStatus         VerificationStatus `json:"verification_status" db:"verification_status"`
	RequiredDocumentsCount     int                `json:"required_documents_count" db:"required_documents_count"`
	SubmittedDocumentsCount    int                `json:"submitted_documents_count" db:"submitted_documents_count"`
	ApprovedDocumentsCount     int                `json:"approved_documents_count" db:"approved_documents_count"`
	DocumentsSubmittedAt       *time.Time         `json:"documents_submitted_at" db:"documents_submitted_at"`
	DocumentsApprovedAt        *time.Time         `json:"documents_approved_at" db:"documents_approved_at"`
	BackgroundCheckCompletedAt *time.Time         `json:"background_check_completed_at" db:"background_check_completed_at"`
	ApprovedBy                 *uuid.UUID         `json:"approved_by" db:"approved_by"`
	ApprovedAt                 *time.Time         `json:"approved_at" db:"approved_at"`
	RejectionReason            *string            `json:"rejection_reason" db:"rejection_reason"`
	SuspendedAt                *time.Time         `json:"suspended_at" db:"suspended_at"`
	SuspendedBy                *uuid.UUID         `json:"suspended_by" db:"suspended_by"`
	SuspensionReason           *string            `json:"suspension_reason" db:"suspension_reason"`
	SuspensionEndDate          *time.Time         `json:"suspension_end_date" db:"suspension_end_date"`
	NextDocumentExpiry         *time.Time         `json:"next_document_expiry" db:"next_document_expiry"`
	ExpiryWarningSentAt        *time.Time         `json:"expiry_warning_sent_at" db:"expiry_warning_sent_at"`
	CreatedAt                  time.Time          `json:"created_at" db:"created_at"`
	UpdatedAt                  time.Time          `json:"updated_at" db:"updated_at"`
}

type DocumentVerificationHistory struct {
	ID             uuid.UUID              `json:"id" db:"id"`
	DocumentID     uuid.UUID              `json:"document_id" db:"document_id"`
	Action         string                 `json:"action" db:"action"`
	PreviousStatus *string                `json:"previous_status" db:"previous_status"`
	NewStatus      *string                `json:"new_status" db:"new_status"`
	PerformedBy    *uuid.UUID             `json:"performed_by" db:"performed_by"`
	IsSystemAction bool                   `json:"is_system_action" db:"is_system_action"`
	Notes          *string                `json:"notes" db:"notes"`
	Metadata       map[string]interface{} `json:"metadata" db:"metadata"`
	CreatedAt      time.Time              `json:"created_at" db:"created_at"`
}

type OCRProcessingQueue struct {
	ID               uuid.UUID              `json:"id" db:"id"`
	DocumentID       uuid.UUID              `json:"document_id" db:"document_id"`
	Status           string                 `json:"status" db:"status"`
	Priority         int                    `json:"priority" db:"priority"`
	Provider         *string                `json:"provider" db:"provider"`
	StartedAt        *time.Time             `json:"started_at" db:"started_at"`
	CompletedAt      *time.Time             `json:"completed_at" db:"completed_at"`
	ProcessingTimeMs *int                   `json:"processing_time_ms" db:"processing_time_ms"`
	RawResponse      map[string]interface{} `json:"raw_response" db:"raw_response"`
	ExtractedData    map[string]interface{} `json:"extracted_data" db:"extracted_data"`
	ConfidenceScore  *float64               `json:"confidence_score" db:"confidence_score"`
	ErrorMessage     *string                `json:"error_message" db:"error_message"`
	RetryCount       int                    `json:"retry_count" db:"retry_count"`
	MaxRetries       int                    `json:"max_retries" db:"max_retries"`
	NextRetryAt      *time.Time             `json:"next_retry_at" db:"next_retry_at"`
	CreatedAt        time.Time              `json:"created_at" db:"created_at"`
	UpdatedAt        time.Time              `json:"updated_at" db:"updated_at"`
}

type UploadDocumentRequest struct {
	DocumentTypeCode string     `json:"document_type_code" binding:"required"`
	DocumentNumber   string     `json:"document_number"`
	IssueDate        *time.Time `json:"issue_date"`
	ExpiryDate       *time.Time `json:"expiry_date"`
	IssuingAuthority string     `json:"issuing_authority"`
}

type UploadDocumentResponse struct {
	DocumentID   uuid.UUID      `json:"document_id"`
	Status       DocumentStatus `json:"status"`
	FileURL      string         `json:"file_url"`
	Message      string         `json:"message"`
	OCRScheduled bool           `json:"ocr_scheduled"`
}

type ReviewDocumentRequest struct {
	Action          string  `json:"action" binding:"required,oneof=approve reject request_resubmit"`
	RejectionReason string  `json:"rejection_reason"`
	Notes           string  `json:"notes"`
	DocumentNumber  *string `json:"document_number"`
	ExpiryDate      *string `json:"expiry_date"`
}

type DocumentListResponse struct {
	Documents []*DriverDocument `json:"documents"`
	Total     int               `json:"total"`
	Limit     int               `json:"limit"`
	Offset    int               `json:"offset"`
}

type DocumentTypeListResponse struct {
	DocumentTypes []*DocumentType `json:"document_types"`
}

type VerificationStatusResponse struct {
	Status             VerificationStatus     `json:"status"`
	RequiredDocuments  []*DocumentRequirement `json:"required_documents"`
	SubmittedDocuments []*DriverDocument      `json:"submitted_documents"`
	MissingDocuments   []string               `json:"missing_documents"`
	NextExpiry         *time.Time             `json:"next_expiry"`
	CanDrive           bool                   `json:"can_drive"`
	Message            string                 `json:"message"`
}

type DocumentRequirement struct {
	DocumentType *DocumentType   `json:"document_type"`
	Status       string          `json:"status"`
	Document     *DriverDocument `json:"document,omitempty"`
}

type PendingReviewDocument struct {
	Document      *DriverDocument `json:"document"`
	DriverName    string          `json:"driver_name"`
	DriverPhone   string          `json:"driver_phone"`
	DriverEmail   string          `json:"driver_email"`
	DocumentType  string          `json:"document_type"`
	HoursPending  float64         `json:"hours_pending"`
	OCRConfidence *float64        `json:"ocr_confidence"`
}

type ExpiringDocument struct {
	Document        *DriverDocument `json:"document"`
	DriverName      string          `json:"driver_name"`
	DriverEmail     string          `json:"driver_email"`
	DriverPhone     string          `json:"driver_phone"`
	DocumentType    string          `json:"document_type"`
	DaysUntilExpiry int             `json:"days_until_expiry"`
	Urgency         string          `json:"urgency"`
}

type OCRResult struct {
	DocumentNumber   string                 `json:"document_number"`
	FullName         string                 `json:"full_name"`
	DateOfBirth      *time.Time             `json:"date_of_birth"`
	IssueDate        *time.Time             `json:"issue_date"`
	ExpiryDate       *time.Time             `json:"expiry_date"`
	IssuingAuthority string                 `json:"issuing_authority"`
	Address          string                 `json:"address"`
	VehiclePlate     string                 `json:"vehicle_plate"`
	VehicleVIN       string                 `json:"vehicle_vin"`
	Confidence       float64                `json:"confidence"`
	RawText          string                 `json:"raw_text"`
	Metadata         map[string]interface{} `json:"metadata"`
}

type PresignedUploadRequest struct {
	DocumentTypeCode string `json:"document_type_code" binding:"required"`
	FileName         string `json:"file_name" binding:"required"`
	ContentType      string `json:"content_type" binding:"required"`
	IsFrontSide      bool   `json:"is_front_side"`
}

type PresignedUploadResponse struct {
	UploadURL   string            `json:"upload_url"`
	Method      string            `json:"method"`
	Headers     map[string]string `json:"headers"`
	ExpiresAt   time.Time         `json:"expires_at"`
	FileKey     string            `json:"file_key"`
	CallbackURL string            `json:"callback_url"`
}

type UploadCompleteRequest struct {
	FileKey          string     `json:"file_key" binding:"required"`
	DocumentTypeCode string     `json:"document_type_code" binding:"required"`
	IsFrontSide      bool       `json:"is_front_side"`
	DocumentNumber   string     `json:"document_number"`
	IssueDate        *time.Time `json:"issue_date"`
	ExpiryDate       *time.Time `json:"expiry_date"`
	IssuingAuthority string     `json:"issuing_authority"`
}
