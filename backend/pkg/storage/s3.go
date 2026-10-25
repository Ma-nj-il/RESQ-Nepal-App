package storage

import (
	"context"
	"fmt"
	"io"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	"go.uber.org/zap"
)

type S3Storage struct {
	client  *s3.Client
	bucket  string
	baseURL string
}

type S3Config struct {
	Bucket    string
	Region    string
	Endpoint  string
	AccessKey string
	SecretKey string
	BaseURL   string
}

func NewS3Storage(ctx context.Context, cfg S3Config) (*S3Storage, error) {
	var awsCfg aws.Config
	var err error

	opts := []func(*config.LoadOptions) error{
		config.WithRegion(cfg.Region),
	}

	if cfg.AccessKey != "" && cfg.SecretKey != "" {
		opts = append(opts, config.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(cfg.AccessKey, cfg.SecretKey, ""),
		))
	}

	awsCfg, err = config.LoadDefaultConfig(ctx, opts...)
	if err != nil {
		return nil, fmt.Errorf("failed to load AWS config: %w", err)
	}

	s3Opts := []func(*s3.Options){}

	if cfg.Endpoint != "" {
		s3Opts = append(s3Opts, func(o *s3.Options) {
			o.BaseEndpoint = aws.String(cfg.Endpoint)
			o.UsePathStyle = true
		})
	}

	client := s3.NewFromConfig(awsCfg, s3Opts...)

	baseURL := cfg.BaseURL
	if baseURL == "" {
		if cfg.Endpoint != "" {
			baseURL = fmt.Sprintf("%s/%s", cfg.Endpoint, cfg.Bucket)
		} else {
			baseURL = fmt.Sprintf("https://%s.s3.%s.amazonaws.com", cfg.Bucket, cfg.Region)
		}
	}

	return &S3Storage{
		client:  client,
		bucket:  cfg.Bucket,
		baseURL: baseURL,
	}, nil
}

// Upload uploads a file to S3
func (s *S3Storage) Upload(ctx context.Context, key string, reader io.Reader, size int64, contentType string) (*UploadResult, error) {
	input := &s3.PutObjectInput{
		Bucket:        aws.String(s.bucket),
		Key:           aws.String(key),
		Body:          reader,
		ContentLength: aws.Int64(size),
		ContentType:   aws.String(contentType),
		ACL:           types.ObjectCannedACLPrivate,
	}

	_, err := s.client.PutObject(ctx, input)
	if err != nil {
		logger.Error("Failed to upload to S3", zap.String("key", key), zap.Error(err))
		return nil, fmt.Errorf("failed to upload to S3: %w", err)
	}

	logger.Info("File uploaded to S3", zap.String("key", key), zap.Int64("size", size))

	return &UploadResult{
		Key:        key,
		URL:        s.GetURL(key),
		Size:       size,
		MimeType:   contentType,
		UploadedAt: time.Now(),
	}, nil
}

// Download downloads a file from S3
func (s *S3Storage) Download(ctx context.Context, key string) (io.ReadCloser, error) {
	input := &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	}

	output, err := s.client.GetObject(ctx, input)
	if err != nil {
		return nil, fmt.Errorf("failed to download from S3: %w", err)
	}

	return output.Body, nil
}

// Delete deletes a file from S3
func (s *S3Storage) Delete(ctx context.Context, key string) error {
	input := &s3.DeleteObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	}

	_, err := s.client.DeleteObject(ctx, input)
	if err != nil {
		logger.Error("Failed to delete from S3", zap.String("key", key), zap.Error(err))
		return fmt.Errorf("failed to delete from S3: %w", err)
	}

	logger.Info("File deleted from S3", zap.String("key", key))
	return nil
}

// GetURL returns the public URL for a file
func (s *S3Storage) GetURL(key string) string {
	return fmt.Sprintf("%s/%s", s.baseURL, key)
}

// GetPresignedUploadURL generates a presigned URL for direct upload
func (s *S3Storage) GetPresignedUploadURL(ctx context.Context, key string, contentType string, expiresIn time.Duration) (*PresignedURLResult, error) {
	presignClient := s3.NewPresignClient(s.client)

	input := &s3.PutObjectInput{
		Bucket:      aws.String(s.bucket),
		Key:         aws.String(key),
		ContentType: aws.String(contentType),
	}

	presignedReq, err := presignClient.PresignPutObject(ctx, input, s3.WithPresignExpires(expiresIn))
	if err != nil {
		return nil, fmt.Errorf("failed to generate presigned upload URL: %w", err)
	}

	// Convert http.Header (map[string][]string) to map[string]string
	headers := make(map[string]string)
	for k, v := range presignedReq.SignedHeader {
		if len(v) > 0 {
			headers[k] = v[0]
		}
	}

	return &PresignedURLResult{
		URL:       presignedReq.URL,
		Method:    presignedReq.Method,
		Headers:   headers,
		ExpiresAt: time.Now().Add(expiresIn),
	}, nil
}

// GetPresignedDownloadURL generates a presigned URL for direct download
func (s *S3Storage) GetPresignedDownloadURL(ctx context.Context, key string, expiresIn time.Duration) (*PresignedURLResult, error) {
	presignClient := s3.NewPresignClient(s.client)

	input := &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	}

	presignedReq, err := presignClient.PresignGetObject(ctx, input, s3.WithPresignExpires(expiresIn))
	if err != nil {
		return nil, fmt.Errorf("failed to generate presigned download URL: %w", err)
	}

	return &PresignedURLResult{
		URL:       presignedReq.URL,
		Method:    presignedReq.Method,
		ExpiresAt: time.Now().Add(expiresIn),
	}, nil
}

// Exists checks if a file exists in S3
func (s *S3Storage) Exists(ctx context.Context, key string) (bool, error) {
	input := &s3.HeadObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	}

	_, err := s.client.HeadObject(ctx, input)
	if err != nil {
		// Check if it's a not found error
		return false, nil
	}

	return true, nil
}

// Copy copies a file within S3
func (s *S3Storage) Copy(ctx context.Context, sourceKey, destKey string) error {
	input := &s3.CopyObjectInput{
		Bucket:     aws.String(s.bucket),
		CopySource: aws.String(fmt.Sprintf("%s/%s", s.bucket, sourceKey)),
		Key:        aws.String(destKey),
	}

	_, err := s.client.CopyObject(ctx, input)
	if err != nil {
		return fmt.Errorf("failed to copy object in S3: %w", err)
	}

	return nil
}
