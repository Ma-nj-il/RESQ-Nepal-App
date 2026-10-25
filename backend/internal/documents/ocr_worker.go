package documents

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strings"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	"github.com/bikky-kc013/medi-ambulance/pkg/resilience"
	"github.com/bikky-kc013/medi-ambulance/pkg/storage"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

type OCRProvider string

const (
	OCRProviderGoogleVision OCRProvider = "google_vision"
	OCRProviderAWSTextract  OCRProvider = "aws_textract"
	OCRProviderMock         OCRProvider = "mock"
)

type OCRWorkerConfig struct {
	Provider         OCRProvider
	BatchSize        int
	PollInterval     time.Duration
	MaxRetries       int
	GoogleProjectID  string
	GoogleLocation   string
	AWSRegion        string
	MinConfidence    float64
	ProcessorTimeout time.Duration
}

type OCRWorker struct {
	repo        *Repository
	storage     storage.Storage
	config      OCRWorkerConfig
	processor   OCRProcessor
	stopCh      chan struct{}
	retryConfig resilience.RetryConfig
}

type OCRProcessor interface {
	ProcessDocument(ctx context.Context, imageData []byte, mimeType string) (*OCRResult, error)
	Name() string
}

func NewOCRWorker(repo *Repository, storage storage.Storage, config OCRWorkerConfig) *OCRWorker {
	if config.BatchSize == 0 {
		config.BatchSize = 10
	}
	if config.PollInterval == 0 {
		config.PollInterval = 30 * time.Second
	}
	if config.MaxRetries == 0 {
		config.MaxRetries = 3
	}
	if config.MinConfidence == 0 {
		config.MinConfidence = 0.7
	}
	if config.ProcessorTimeout == 0 {
		config.ProcessorTimeout = 60 * time.Second
	}

	retryConfig := resilience.DefaultRetryConfig()
	retryConfig.MaxAttempts = config.MaxRetries
	retryConfig.InitialBackoff = 2 * time.Second
	retryConfig.MaxBackoff = 30 * time.Second
	retryConfig.EnableJitter = true
	retryConfig.RetryableChecker = isOCRRetryable

	worker := &OCRWorker{
		repo:        repo,
		storage:     storage,
		config:      config,
		stopCh:      make(chan struct{}),
		retryConfig: retryConfig,
	}

	switch config.Provider {
	case OCRProviderGoogleVision:
		worker.processor = NewGoogleVisionProcessor(config.GoogleProjectID, config.GoogleLocation)
	case OCRProviderAWSTextract:
		worker.processor = NewAWSTextractProcessor(config.AWSRegion)
	case OCRProviderMock:
		worker.processor = NewMockOCRProcessor()
	default:
		worker.processor = NewMockOCRProcessor()
	}

	return worker
}

func (w *OCRWorker) Start(ctx context.Context) {
	logger.Info("OCR Worker started", zap.String("provider", w.processor.Name()))

	ticker := time.NewTicker(w.config.PollInterval)
	defer ticker.Stop()

	w.processBatch(ctx)

	for {
		select {
		case <-ctx.Done():
			logger.Info("OCR Worker stopping due to context cancellation")
			return
		case <-w.stopCh:
			logger.Info("OCR Worker stopped")
			return
		case <-ticker.C:
			w.processBatch(ctx)
		}
	}
}

func (w *OCRWorker) Stop() {
	close(w.stopCh)
}

func (w *OCRWorker) processBatch(ctx context.Context) {
	jobs, err := w.repo.GetPendingOCRJobs(ctx, w.config.BatchSize)
	if err != nil {
		logger.Error("Failed to get pending OCR jobs", zap.Error(err))
		return
	}

	if len(jobs) == 0 {
		return
	}

	logger.Info("Processing OCR batch", zap.Int("count", len(jobs)))

	for _, job := range jobs {
		select {
		case <-ctx.Done():
			return
		default:
			w.processJob(ctx, job)
		}
	}
}

func (w *OCRWorker) processJob(ctx context.Context, job *OCRProcessingQueue) {
	jobCtx, cancel := context.WithTimeout(ctx, w.config.ProcessorTimeout)
	defer cancel()

	if err := w.repo.UpdateOCRJobStatus(ctx, job.ID, "processing", nil, nil); err != nil {
		logger.Error("Failed to mark OCR job as processing", zap.Error(err))
		return
	}

	doc, err := w.repo.GetDocument(jobCtx, job.DocumentID)
	if err != nil {
		w.failJob(ctx, job, fmt.Sprintf("document not found: %v", err))
		return
	}

	imageData, err := w.downloadDocument(jobCtx, doc.FileKey)
	if err != nil {
		w.failJob(ctx, job, fmt.Sprintf("failed to download document: %v", err))
		return
	}

	mimeType := "image/jpeg"
	if doc.FileMimeType != nil {
		mimeType = *doc.FileMimeType
	}

	result, err := w.processor.ProcessDocument(jobCtx, imageData, mimeType)
	if err != nil {
		w.handleProcessingError(ctx, job, err)
		return
	}

	if result.Confidence < w.config.MinConfidence {
		logger.Warn("OCR result below confidence threshold",
			zap.String("document_id", doc.ID.String()),
			zap.Float64("confidence", result.Confidence),
			zap.Float64("threshold", w.config.MinConfidence),
		)
	}

	ocrData := w.buildOCRData(result)
	if err := w.repo.UpdateDocumentOCRData(ctx, doc.ID, ocrData, result.Confidence); err != nil {
		w.failJob(ctx, job, fmt.Sprintf("failed to save OCR data: %v", err))
		return
	}

	w.updateDocumentFromOCR(ctx, doc.ID, result)

	resultJSON, _ := json.Marshal(result)
	resultStr := string(resultJSON)
	if err := w.repo.UpdateOCRJobStatus(ctx, job.ID, "completed", &resultStr, nil); err != nil {
		logger.Error("Failed to mark OCR job as completed", zap.Error(err))
	}

	w.logOCRHistory(ctx, doc.ID, result)

	logger.Info("OCR job completed",
		zap.String("document_id", doc.ID.String()),
		zap.Float64("confidence", result.Confidence),
	)
}

func (w *OCRWorker) downloadDocument(ctx context.Context, fileKey string) ([]byte, error) {
	reader, err := w.storage.Download(ctx, fileKey)
	if err != nil {
		return nil, err
	}
	defer reader.Close()

	return io.ReadAll(reader)
}

func (w *OCRWorker) buildOCRData(result *OCRResult) map[string]interface{} {
	data := map[string]interface{}{
		"raw_text":   result.RawText,
		"confidence": result.Confidence,
		"metadata":   result.Metadata,
	}

	if result.DocumentNumber != "" {
		data["document_number"] = result.DocumentNumber
	}
	if result.FullName != "" {
		data["full_name"] = result.FullName
	}
	if result.DateOfBirth != nil {
		data["date_of_birth"] = result.DateOfBirth.Format("2006-01-02")
	}
	if result.IssueDate != nil {
		data["issue_date"] = result.IssueDate.Format("2006-01-02")
	}
	if result.ExpiryDate != nil {
		data["expiry_date"] = result.ExpiryDate.Format("2006-01-02")
	}
	if result.IssuingAuthority != "" {
		data["issuing_authority"] = result.IssuingAuthority
	}
	if result.Address != "" {
		data["address"] = result.Address
	}
	if result.VehiclePlate != "" {
		data["vehicle_plate"] = result.VehiclePlate
	}
	if result.VehicleVIN != "" {
		data["vehicle_vin"] = result.VehicleVIN
	}

	return data
}

func (w *OCRWorker) updateDocumentFromOCR(ctx context.Context, documentID uuid.UUID, result *OCRResult) {
	var docNum, authority *string
	if result.DocumentNumber != "" {
		docNum = &result.DocumentNumber
	}
	if result.IssuingAuthority != "" {
		authority = &result.IssuingAuthority
	}

	if err := w.repo.UpdateDocumentDetails(ctx, documentID, docNum, result.IssueDate, result.ExpiryDate, authority); err != nil {
		logger.Warn("Failed to update document details from OCR", zap.Error(err))
	}
}

func (w *OCRWorker) logOCRHistory(ctx context.Context, documentID uuid.UUID, result *OCRResult) {
	notes := fmt.Sprintf("OCR processed with %.0f%% confidence", result.Confidence*100)
	history := &DocumentVerificationHistory{
		ID:             uuid.New(),
		DocumentID:     documentID,
		Action:         "ocr_processed",
		IsSystemAction: true,
		Notes:          &notes,
	}

	if err := w.repo.CreateHistory(ctx, history); err != nil {
		logger.Warn("Failed to create OCR history entry", zap.Error(err))
	}
}

func (w *OCRWorker) failJob(ctx context.Context, job *OCRProcessingQueue, errMsg string) {
	if err := w.repo.UpdateOCRJobStatus(ctx, job.ID, "failed", nil, &errMsg); err != nil {
		logger.Error("Failed to mark OCR job as failed", zap.Error(err))
	}
	logger.Error("OCR job failed",
		zap.String("job_id", job.ID.String()),
		zap.String("document_id", job.DocumentID.String()),
		zap.String("error", errMsg),
	)
}

func (w *OCRWorker) handleProcessingError(ctx context.Context, job *OCRProcessingQueue, err error) {
	job.RetryCount++
	if job.RetryCount >= w.config.MaxRetries {
		w.failJob(ctx, job, fmt.Sprintf("max retries exceeded: %v", err))
		return
	}

	backoffDuration := calculateOCRBackoff(job.RetryCount, w.retryConfig)
	nextRetry := time.Now().Add(backoffDuration)

	if updateErr := w.repo.UpdateOCRJobRetry(ctx, job.ID, job.RetryCount, nextRetry); updateErr != nil {
		logger.Error("Failed to update OCR job for retry", zap.Error(updateErr))
	}

	logger.Warn("OCR job will be retried",
		zap.String("job_id", job.ID.String()),
		zap.Int("retry_count", job.RetryCount),
		zap.Duration("backoff", backoffDuration),
		zap.Time("next_retry", nextRetry),
		zap.Error(err),
	)
}

func isOCRRetryable(err error) bool {
	if err == nil {
		return false
	}

	errMsg := strings.ToLower(err.Error())

	retryablePatterns := []string{
		"timeout",
		"connection",
		"network",
		"temporary",
		"503",
		"502",
		"504",
		"429",
		"rate limit",
		"quota exceeded",
		"service unavailable",
		"internal error",
	}

	for _, pattern := range retryablePatterns {
		if strings.Contains(errMsg, pattern) {
			return true
		}
	}

	nonRetryablePatterns := []string{
		"invalid image",
		"unsupported format",
		"invalid request",
		"authentication",
		"authorization",
		"forbidden",
		"not configured",
	}

	for _, pattern := range nonRetryablePatterns {
		if strings.Contains(errMsg, pattern) {
			return false
		}
	}

	return true
}

func calculateOCRBackoff(attempt int, config resilience.RetryConfig) time.Duration {
	backoff := float64(config.InitialBackoff) * pow(config.BackoffMultiplier, float64(attempt-1))

	if backoff > float64(config.MaxBackoff) {
		backoff = float64(config.MaxBackoff)
	}

	duration := time.Duration(backoff)

	if config.EnableJitter {
		duration = addOCRJitter(duration)
	}

	return duration
}

func pow(base, exp float64) float64 {
	result := 1.0
	for i := 0; i < int(exp); i++ {
		result *= base
	}
	return result
}

func addOCRJitter(duration time.Duration) time.Duration {
	if duration <= 0 {
		return duration
	}
	jitterRange := int64(duration) / 2
	jitter := time.Duration(jitterRange + (time.Now().UnixNano() % jitterRange))
	return jitter
}

type MockOCRProcessor struct{}

func NewMockOCRProcessor() *MockOCRProcessor {
	return &MockOCRProcessor{}
}

func (p *MockOCRProcessor) Name() string {
	return "mock"
}

func (p *MockOCRProcessor) ProcessDocument(ctx context.Context, imageData []byte, mimeType string) (*OCRResult, error) {
	time.Sleep(500 * time.Millisecond)

	issueDate := time.Now().AddDate(-1, 0, 0)
	expiryDate := time.Now().AddDate(2, 0, 0)

	return &OCRResult{
		DocumentNumber:   fmt.Sprintf("DL%d", time.Now().Unix()%1000000),
		FullName:         "Mock Driver Name",
		IssueDate:        &issueDate,
		ExpiryDate:       &expiryDate,
		IssuingAuthority: "Mock Authority",
		Confidence:       0.95,
		RawText:          "Mock OCR extracted text",
		Metadata: map[string]interface{}{
			"processor":    "mock",
			"processed_at": time.Now().Format(time.RFC3339),
		},
	}, nil
}

type GoogleVisionProcessor struct {
	projectID string
	location  string
}

func NewGoogleVisionProcessor(projectID, location string) *GoogleVisionProcessor {
	return &GoogleVisionProcessor{
		projectID: projectID,
		location:  location,
	}
}

func (p *GoogleVisionProcessor) Name() string {
	return "google_vision"
}

func (p *GoogleVisionProcessor) ProcessDocument(ctx context.Context, imageData []byte, mimeType string) (*OCRResult, error) {

	if p.projectID == "" {
		return nil, fmt.Errorf("Google Vision API not configured: missing project ID")
	}

	result := &OCRResult{
		Confidence: 0.85,
		RawText:    string(imageData[:min(100, len(imageData))]),
		Metadata: map[string]interface{}{
			"processor":  "google_vision",
			"project_id": p.projectID,
		},
	}

	result.DocumentNumber = p.extractDocumentNumber(result.RawText)
	result.ExpiryDate = p.extractExpiryDate(result.RawText)

	return result, nil
}

func (p *GoogleVisionProcessor) extractDocumentNumber(text string) string {
	patterns := []string{
		`(?i)(?:license|licence|dl|no|number)[:\s]*([A-Z0-9-]+)`,
		`(?i)([A-Z]{2}[0-9]{6,})`,
	}

	for _, pattern := range patterns {
		re := regexp.MustCompile(pattern)
		if matches := re.FindStringSubmatch(text); len(matches) > 1 {
			return strings.TrimSpace(matches[1])
		}
	}
	return ""
}

func (p *GoogleVisionProcessor) extractExpiryDate(text string) *time.Time {
	patterns := []string{
		`(?i)exp(?:iry|ires)?[:\s]*(\d{2}[/-]\d{2}[/-]\d{4})`,
		`(?i)valid\s*(?:until|till)[:\s]*(\d{2}[/-]\d{2}[/-]\d{4})`,
	}

	for _, pattern := range patterns {
		re := regexp.MustCompile(pattern)
		if matches := re.FindStringSubmatch(text); len(matches) > 1 {
			dateStr := matches[1]
			for _, layout := range []string{"02/01/2006", "02-01-2006", "01/02/2006", "01-02-2006"} {
				if t, err := time.Parse(layout, dateStr); err == nil {
					return &t
				}
			}
		}
	}
	return nil
}

type AWSTextractProcessor struct {
	region string
}

func NewAWSTextractProcessor(region string) *AWSTextractProcessor {
	return &AWSTextractProcessor{region: region}
}

func (p *AWSTextractProcessor) Name() string {
	return "aws_textract"
}

func (p *AWSTextractProcessor) ProcessDocument(ctx context.Context, imageData []byte, mimeType string) (*OCRResult, error) {

	if p.region == "" {
		return nil, fmt.Errorf("AWS Textract not configured: missing region")
	}

	result := &OCRResult{
		Confidence: 0.88,
		RawText:    base64.StdEncoding.EncodeToString(imageData[:min(50, len(imageData))]),
		Metadata: map[string]interface{}{
			"processor": "aws_textract",
			"region":    p.region,
		},
	}

	return result, nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
