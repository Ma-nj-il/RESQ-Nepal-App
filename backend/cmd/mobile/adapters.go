package main

import (
	"context"
	"fmt"
	"io"
	"time"

	"github.com/bikky-kc013/medi-ambulance/internal/onboarding"
	"github.com/bikky-kc013/medi-ambulance/internal/pool"
	"github.com/bikky-kc013/medi-ambulance/internal/ridetypes"
	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	"github.com/bikky-kc013/medi-ambulance/pkg/models"
	"github.com/bikky-kc013/medi-ambulance/pkg/storage"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

type stubMapsService struct{}

func (s *stubMapsService) GetRoute(_ context.Context, origin, destination pool.Location) (*pool.RouteInfo, error) {
	logger.Warn("stubMapsService.GetRoute called — wire a real MapsService",
		zap.Float64("origin_latitude", origin.Latitude), zap.Float64("origin_longitude", origin.Longitude))
	return &pool.RouteInfo{DistanceKm: 0, DurationMinutes: 0}, nil
}

func (s *stubMapsService) GetMultiStopRoute(_ context.Context, stops []pool.Location) (*pool.MultiStopRouteInfo, error) {
	logger.Warn("stubMapsService.GetMultiStopRoute called — wire a real MapsService",
		zap.Int("stops", len(stops)))
	return &pool.MultiStopRouteInfo{TotalDistanceKm: 0, TotalDurationMinutes: 0}, nil
}

type stubStorage struct{}

func (s *stubStorage) Upload(_ context.Context, key string, _ io.Reader, _ int64, _ string) (*storage.UploadResult, error) {
	logger.Warn("stubStorage.Upload called — wire a real Storage provider", zap.String("key", key))
	return nil, fmt.Errorf("storage not configured")
}

func (s *stubStorage) Download(_ context.Context, key string) (io.ReadCloser, error) {
	logger.Warn("stubStorage.Download called — wire a real Storage provider", zap.String("key", key))
	return nil, fmt.Errorf("storage not configured")
}

func (s *stubStorage) Delete(_ context.Context, key string) error {
	logger.Warn("stubStorage.Delete called — wire a real Storage provider", zap.String("key", key))
	return fmt.Errorf("storage not configured")
}

func (s *stubStorage) GetURL(key string) string { return "" }

func (s *stubStorage) GetPresignedUploadURL(_ context.Context, key, _ string, _ time.Duration) (*storage.PresignedURLResult, error) {
	return nil, fmt.Errorf("storage not configured")
}

func (s *stubStorage) GetPresignedDownloadURL(_ context.Context, key string, _ time.Duration) (*storage.PresignedURLResult, error) {
	return nil, fmt.Errorf("storage not configured")
}

func (s *stubStorage) Exists(_ context.Context, _ string) (bool, error) { return false, nil }
func (s *stubStorage) Copy(_ context.Context, _, _ string) error {
	return fmt.Errorf("storage not configured")
}

type stubDocumentService struct{}

func (s *stubDocumentService) GetDriverDocuments(_ context.Context, driverID uuid.UUID) ([]onboarding.DocumentInfo, error) {
	logger.Warn("stubDocumentService.GetDriverDocuments called — wire a real DocumentService",
		zap.String("driver_id", driverID.String()))
	return []onboarding.DocumentInfo{}, nil
}

func (s *stubDocumentService) GetRequiredDocumentTypes(_ context.Context) ([]onboarding.DocumentTypeInfo, error) {
	logger.Warn("stubDocumentService.GetRequiredDocumentTypes called — wire a real DocumentService")
	return []onboarding.DocumentTypeInfo{}, nil
}

func (s *stubDocumentService) GetDriverVerificationStatus(_ context.Context, driverID uuid.UUID) (*onboarding.VerificationStatus, error) {
	logger.Warn("stubDocumentService.GetDriverVerificationStatus called — wire a real DocumentService",
		zap.String("driver_id", driverID.String()))
	return &onboarding.VerificationStatus{Status: "unknown"}, nil
}

type stubPaymentService struct{}

func (s *stubPaymentService) GetRideFare(_ context.Context, rideID uuid.UUID) (float64, string, error) {
	logger.Warn("stubPaymentService.GetRideFare called — wire a real PaymentService",
		zap.String("ride_id", rideID.String()))
	return 0, "USD", fmt.Errorf("payment service not configured")
}

func (s *stubPaymentService) ProcessSplitPayment(_ context.Context, userID, rideID uuid.UUID, amount float64, method string) (uuid.UUID, error) {
	logger.Warn("stubPaymentService.ProcessSplitPayment called — wire a real PaymentService",
		zap.String("user_id", userID.String()), zap.Float64("amount", amount))
	return uuid.Nil, fmt.Errorf("payment service not configured")
}

type stubSplitNotificationService struct{}

func (s *stubSplitNotificationService) SendSplitInvitation(_ context.Context, _ uuid.UUID, _ uuid.UUID, _ string, _ float64) error {
	logger.Warn("stubSplitNotificationService.SendSplitInvitation called — wire a real NotificationService")
	return nil
}

func (s *stubSplitNotificationService) SendSplitReminder(_ context.Context, _ uuid.UUID, _ uuid.UUID, _ float64) error {
	return nil
}

func (s *stubSplitNotificationService) SendSplitAccepted(_ context.Context, _ uuid.UUID, _ string) error {
	return nil
}

func (s *stubSplitNotificationService) SendSplitCompleted(_ context.Context, _ uuid.UUID) error {
	return nil
}

type stubPaymentProcessor struct{}

func (s *stubPaymentProcessor) ChargeSubscription(_ context.Context, userID uuid.UUID, amount float64, currency, paymentMethod string) error {
	logger.Warn("stubPaymentProcessor.ChargeSubscription called — wire a real PaymentProcessor",
		zap.String("user_id", userID.String()), zap.Float64("amount", amount))
	return fmt.Errorf("payment processor not configured")
}

type stubSMSSender struct{}

func (s *stubSMSSender) SendOTP(to, otp string) (string, error) {
	logger.Warn("stubSMSSender.SendOTP called — wire a real SMSSender",
		zap.String("to", to[:3]+"***"))
	return "", fmt.Errorf("SMS sender not configured")
}

type stubDriverService struct{}

func (s *stubDriverService) GetDriverByUserID(_ context.Context, userID uuid.UUID) (*models.Driver, error) {
	logger.Warn("stubDriverService.GetDriverByUserID called — documents handler doesn't need this for driver endpoints",
		zap.String("user_id", userID.String()))
	return nil, fmt.Errorf("driver service not configured for documents")
}

type rideTypesServiceAdapter struct {
	service interface {
		GetAvailableRideTypes(ctx context.Context, latitude, longitude float64) ([]*ridetypes.RideType, error)
	}
}

func (a *rideTypesServiceAdapter) GetAvailableRideTypes(ctx interface{}, latitude, longitude float64) ([]interface{}, error) {
	ctxTyped, ok := ctx.(context.Context)
	if !ok {
		return nil, fmt.Errorf("invalid context type")
	}

	rideTypes, err := a.service.GetAvailableRideTypes(ctxTyped, latitude, longitude)
	if err != nil {
		return nil, err
	}

	result := make([]interface{}, len(rideTypes))
	for i, rt := range rideTypes {
		rtMap := map[string]interface{}{
			"id":       rt.ID.String(),
			"name":     rt.Name,
			"capacity": rt.Capacity,
		}
		if rt.Description != nil {
			rtMap["description"] = *rt.Description
		} else {
			rtMap["description"] = ""
		}
		if rt.Icon != nil {
			rtMap["icon_url"] = *rt.Icon
		}
		result[i] = rtMap
	}

	return result, nil
}
