package storage

import (
	"context"
	"fmt"
	"io"
	"path"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Provider represents a storage provider type
type Provider string

const (
	ProviderS3    Provider = "s3"
	ProviderGCS   Provider = "gcs"
	ProviderLocal Provider = "local"
)

// Config holds storage configuration
type Config struct {
	Provider       Provider `json:"provider"`
	Bucket         string   `json:"bucket"`
	Region         string   `json:"region"`
	Endpoint       string   `json:"endpoint"` // For S3-compatible storage
	AccessKey      string   `json:"access_key"`
	SecretKey      string   `json:"secret_key"`
	BaseURL        string   `json:"base_url"` // Public URL prefix
	LocalPath      string   `json:"local_path"` // For local storage
	MaxFileSizeMB  int      `json:"max_file_size_mb"`
	AllowedTypes   []string `json:"allowed_types"` // e.g., ["image/jpeg", "image/png", "application/pdf"]
}

// UploadResult contains the result of an upload operation
type UploadResult struct {
	Key       string    `json:"key"`
	URL       string    `json:"url"`
	Size      int64     `json:"size"`
	MimeType  string    `json:"mime_type"`
	UploadedAt time.Time `json:"uploaded_at"`
}

// PresignedURLResult contains a presigned URL for direct upload/download
type PresignedURLResult struct {
	URL       string            `json:"url"`
	Method    string            `json:"method"`
	Headers   map[string]string `json:"headers,omitempty"`
	ExpiresAt time.Time         `json:"expires_at"`
}

// Storage interface defines the storage operations
type Storage interface {
	// Upload uploads a file to storage
	Upload(ctx context.Context, key string, reader io.Reader, size int64, contentType string) (*UploadResult, error)

	// Download downloads a file from storage
	Download(ctx context.Context, key string) (io.ReadCloser, error)

	// Delete deletes a file from storage
	Delete(ctx context.Context, key string) error

	// GetURL returns the public URL for a file
	GetURL(key string) string

	// GetPresignedUploadURL generates a presigned URL for direct upload
	GetPresignedUploadURL(ctx context.Context, key string, contentType string, expiresIn time.Duration) (*PresignedURLResult, error)

	// GetPresignedDownloadURL generates a presigned URL for direct download
	GetPresignedDownloadURL(ctx context.Context, key string, expiresIn time.Duration) (*PresignedURLResult, error)

	// Exists checks if a file exists
	Exists(ctx context.Context, key string) (bool, error)

	// Copy copies a file within storage
	Copy(ctx context.Context, sourceKey, destKey string) error
}

// GenerateDocumentKey generates a unique storage key for a document
func GenerateDocumentKey(driverID uuid.UUID, documentType, filename string) string {
	ext := path.Ext(filename)
	uniqueID := uuid.New().String()[:8]
	timestamp := time.Now().Format("20060102")

	// Format: drivers/{driver_id}/documents/{document_type}/{timestamp}_{unique_id}{ext}
	return fmt.Sprintf("drivers/%s/documents/%s/%s_%s%s",
		driverID.String(),
		strings.ToLower(documentType),
		timestamp,
		uniqueID,
		ext,
	)
}

// GenerateProfilePhotoKey generates a unique storage key for profile photos
func GenerateProfilePhotoKey(userID uuid.UUID, filename string) string {
	ext := path.Ext(filename)
	uniqueID := uuid.New().String()[:8]

	return fmt.Sprintf("users/%s/profile/%s%s", userID.String(), uniqueID, ext)
}

// GenerateVehiclePhotoKey generates a unique storage key for vehicle photos
func GenerateVehiclePhotoKey(driverID uuid.UUID, photoType, filename string) string {
	ext := path.Ext(filename)
	uniqueID := uuid.New().String()[:8]

	return fmt.Sprintf("drivers/%s/vehicle/%s_%s%s",
		driverID.String(),
		strings.ToLower(photoType),
		uniqueID,
		ext,
	)
}

// ValidateMimeType checks if the mime type is allowed
func ValidateMimeType(mimeType string, allowedTypes []string) bool {
	if len(allowedTypes) == 0 {
		return true
	}

	mimeType = strings.ToLower(mimeType)
	for _, allowed := range allowedTypes {
		if strings.ToLower(allowed) == mimeType {
			return true
		}
		// Support wildcards like "image/*"
		if strings.HasSuffix(allowed, "/*") {
			prefix := strings.TrimSuffix(allowed, "*")
			if strings.HasPrefix(mimeType, prefix) {
				return true
			}
		}
	}
	return false
}

// GetMimeTypeFromExtension returns the MIME type for common file extensions
func GetMimeTypeFromExtension(filename string) string {
	ext := strings.ToLower(path.Ext(filename))
	mimeTypes := map[string]string{
		".jpg":  "image/jpeg",
		".jpeg": "image/jpeg",
		".png":  "image/png",
		".gif":  "image/gif",
		".webp": "image/webp",
		".pdf":  "application/pdf",
		".doc":  "application/msword",
		".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	}

	if mime, ok := mimeTypes[ext]; ok {
		return mime
	}
	return "application/octet-stream"
}

// IsImageMimeType checks if the mime type is an image
func IsImageMimeType(mimeType string) bool {
	return strings.HasPrefix(strings.ToLower(mimeType), "image/")
}

// IsPDFMimeType checks if the mime type is a PDF
func IsPDFMimeType(mimeType string) bool {
	return strings.ToLower(mimeType) == "application/pdf"
}
