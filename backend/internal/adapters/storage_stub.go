package adapters

import (
	"context"
	"fmt"
	"io"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	"github.com/bikky-kc013/medi-ambulance/pkg/storage"
	"go.uber.org/zap"
)

type StubStorage struct{ storage.Storage }

func (s *StubStorage) Upload(ctx context.Context, key string, reader io.Reader, size int64, contentType string) (*storage.UploadResult, error) {
	logger.Warn("stubStorage.Upload called — wire a real Storage provider", zap.String("key", key))
	return &storage.UploadResult{URL: "http://example.com/" + key, Key: key}, nil
}

func (s *StubStorage) Download(ctx context.Context, key string) (io.ReadCloser, error) {
	logger.Warn("stubStorage.Download called — wire a real Storage provider", zap.String("key", key))
	return nil, fmt.Errorf("storage not configured")
}

func (s *StubStorage) Delete(ctx context.Context, key string) error {
	logger.Warn("stubStorage.Delete called — wire a real Storage provider", zap.String("key", key))
	return fmt.Errorf("storage not configured")
}

func (s *StubStorage) GetURL(key string) string { return "http://example.com/" + key }

func (s *StubStorage) GetPresignedUploadURL(ctx context.Context, key, contentType string, expiresIn time.Duration) (*storage.PresignedURLResult, error) {
	return &storage.PresignedURLResult{URL: "http://example.com/" + key, Method: "PUT"}, nil
}

func (s *StubStorage) GetPresignedDownloadURL(ctx context.Context, key string, expiresIn time.Duration) (*storage.PresignedURLResult, error) {
	return &storage.PresignedURLResult{URL: "http://example.com/" + key, Method: "GET"}, nil
}

func (s *StubStorage) Exists(ctx context.Context, key string) (bool, error) { return true, nil }

func (s *StubStorage) Copy(ctx context.Context, sourceKey, destKey string) error {
	return fmt.Errorf("storage not configured")
}
