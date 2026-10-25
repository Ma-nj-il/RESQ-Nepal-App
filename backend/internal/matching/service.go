package matching

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	redisClient "github.com/bikky-kc013/medi-ambulance/pkg/redis"
	"github.com/bikky-kc013/medi-ambulance/pkg/websocket"
	"github.com/google/uuid"
	"github.com/nats-io/nats.go"
	"go.uber.org/zap"
)

type GeoService interface {
	FindAvailableDrivers(ctx context.Context, latitude, longitude float64, maxDrivers int) ([]*GeoDriverLocation, error)
	CalculateDistance(latitude1, longitude1, latitude2, longitude2 float64) float64
}

type RidesRepository interface {
	UpdateRideDriver(ctx context.Context, rideID, driverID uuid.UUID) error
	GetRideByID(ctx context.Context, rideID uuid.UUID) (interface{}, error)
}

type Service struct {
	geoService GeoService
	ridesRepo  RidesRepository
	wsHub      *websocket.Hub
	eventBus   *nats.Conn
	redis      redisClient.ClientInterface
	config     MatchingConfig
}

func NewService(
	geoService GeoService,
	ridesRepo RidesRepository,
	wsHub *websocket.Hub,
	eventBus *nats.Conn,
	redis redisClient.ClientInterface,
	config MatchingConfig,
) *Service {
	return &Service{
		geoService: geoService,
		ridesRepo:  ridesRepo,
		wsHub:      wsHub,
		eventBus:   eventBus,
		redis:      redis,
		config:     config,
	}
}

func (s *Service) Start(ctx context.Context) error {
	logger.Info("Starting matching service")

	_, err := s.eventBus.Subscribe("rides.requested", func(msg *nats.Msg) {
		var envelope struct {
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(msg.Data, &envelope); err != nil {
			logger.Error("Failed to unmarshal event envelope", zap.Error(err))
			return
		}

		var event RideRequestedEvent
		if err := json.Unmarshal(envelope.Data, &event); err != nil {
			logger.Error("Failed to unmarshal rides.requested event data", zap.Error(err), zap.String("raw_data", string(envelope.Data)))
			return
		}
		s.onRideRequested(ctx, &event)
	})
	if err != nil {
		return fmt.Errorf("failed to subscribe to rides.requested: %w", err)
	}

	_, err = s.eventBus.Subscribe("rides.accepted", func(msg *nats.Msg) {
		var envelope struct {
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(msg.Data, &envelope); err != nil {
			logger.Error("Failed to unmarshal event envelope", zap.Error(err))
			return
		}

		var event RideAcceptedEvent
		if err := json.Unmarshal(envelope.Data, &event); err != nil {
			logger.Error("Failed to unmarshal rides.accepted event data", zap.Error(err))
			return
		}
		s.onRideAccepted(ctx, &event)
	})
	if err != nil {
		return fmt.Errorf("failed to subscribe to rides.accepted: %w", err)
	}

	_, err = s.eventBus.Subscribe("rides.cancelled", func(msg *nats.Msg) {
		var envelope struct {
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(msg.Data, &envelope); err != nil {
			logger.Error("Failed to unmarshal event envelope", zap.Error(err))
			return
		}

		var event RideCancelledEvent
		if err := json.Unmarshal(envelope.Data, &event); err != nil {
			logger.Error("Failed to unmarshal rides.cancelled event data", zap.Error(err))
			return
		}
		s.onRideCancelled(ctx, &event)
	})
	if err != nil {
		return fmt.Errorf("failed to subscribe to rides.cancelled: %w", err)
	}

	logger.Info("Matching service started successfully")
	return nil
}

func (s *Service) onRideRequested(ctx context.Context, event *RideRequestedEvent) {
	logger.Info("Processing ride request",
		zap.String("ride_id", event.RideID.String()),
		zap.Float64("pickup_latitude", event.PickupLatitude),
		zap.Float64("pickup_longitude", event.PickupLongitude))

	drivers, err := s.findAvailableDrivers(ctx, event.PickupLatitude, event.PickupLongitude)
	if err != nil {
		logger.Error("Failed to find nearby drivers", zap.Error(err))
		return
	}

	if len(drivers) == 0 {
		logger.Warn("No drivers available for ride",
			zap.String("ride_id", event.RideID.String()),
			zap.Float64("radius_km", s.config.MaxSearchRadiusKm))
		return
	}

	logger.Info("Found available drivers",
		zap.String("ride_id", event.RideID.String()),
		zap.Int("count", len(drivers)))

	s.sendOffersToDrivers(ctx, event, drivers)
}

func (s *Service) findAvailableDrivers(ctx context.Context, latitude, longitude float64) ([]DriverLocation, error) {
	logger.Info("Searching for available drivers",
		zap.Float64("pickup_latitude", latitude),
		zap.Float64("pickup_longitude", longitude),
		zap.Int("max_drivers", s.config.MaxDriversToNotify))

	geoDrivers, err := s.geoService.FindAvailableDrivers(ctx, latitude, longitude, s.config.MaxDriversToNotify)
	if err != nil {
		logger.Error("Geo service error", zap.Error(err))
		return nil, fmt.Errorf("failed to find available drivers: %w", err)
	}

	logger.Info("Geo service returned drivers", zap.Int("count", len(geoDrivers)))

	if len(geoDrivers) == 0 {
		return []DriverLocation{}, nil
	}

	drivers := make([]DriverLocation, len(geoDrivers))
	for i, gd := range geoDrivers {
		drivers[i] = DriverLocation{
			UserID:    gd.DriverID,
			DriverID:  gd.DriverID,
			Latitude:  gd.Latitude,
			Longitude: gd.Longitude,
			Distance:  0,
		}
	}

	logger.Info("Found available drivers",
		zap.Int("count", len(drivers)))

	return drivers, nil
}

func (s *Service) sendOffersToDrivers(ctx context.Context, event *RideRequestedEvent, drivers []DriverLocation) {
	expiresAt := time.Now().Add(time.Duration(s.config.OfferTimeoutSeconds) * time.Second)

	batchSize := s.config.FirstBatchSize
	if batchSize > len(drivers) {
		batchSize = len(drivers)
	}

	for i := 0; i < batchSize; i++ {
		driver := drivers[i]
		s.sendOfferToDriver(ctx, event, driver, expiresAt)
	}

	if batchSize < len(drivers) {
		go s.sendOffersWithDelay(ctx, event, drivers[batchSize:], expiresAt)
	}
}

func (s *Service) sendOffersWithDelay(ctx context.Context, event *RideRequestedEvent, drivers []DriverLocation, expiresAt time.Time) {
	time.Sleep(time.Duration(s.config.RetryDelaySeconds) * time.Second)

	isPending, err := s.isRidePending(ctx, event.RideID)
	if err != nil {
		logger.Error("Failed to check ride status", zap.Error(err))
		return
	}

	if !isPending {
		logger.Info("Ride no longer pending, skipping delayed offers",
			zap.String("ride_id", event.RideID.String()))
		return
	}

	for _, driver := range drivers {
		s.sendOfferToDriver(ctx, event, driver, expiresAt)
	}
}

func (s *Service) sendOfferToDriver(ctx context.Context, event *RideRequestedEvent, driver DriverLocation, expiresAt time.Time) {
	// Calculate distance to pickup
	distance := s.geoService.CalculateDistance(
		driver.Latitude, driver.Longitude,
		event.PickupLatitude, event.PickupLongitude,
	)
	driver.Distance = distance

	etaMinutes := int((distance / 30.0) * 60)

	offer := RideOffer{
		RideID:            event.RideID,
		RiderName:         event.RiderName,
		RiderRating:       event.RiderRating,
		PickupLocation:    Location{Latitude: event.PickupLatitude, Longitude: event.PickupLongitude, Address: event.PickupAddress},
		RideType:          event.RideTypeName,
		EstimatedFare:     event.EstimatedFare,
		EstimatedDistance: event.EstimatedDistance,
		EstimatedDuration: event.EstimatedDuration,
		DistanceToPickup:  driver.Distance,
		ETAToPickup:       etaMinutes,
		Currency:          event.Currency,
		ExpiresAt:         expiresAt,
		TimeoutSeconds:    s.config.OfferTimeoutSeconds,
	}

	if event.DropoffLatitude != nil && event.DropoffLongitude != nil {
		offer.DropoffLocation = &Location{
			Latitude:  *event.DropoffLatitude,
			Longitude: *event.DropoffLongitude,
			Address:   *event.DropoffAddress,
		}
	}

	if err := s.trackOffer(ctx, event.RideID, driver.DriverID, expiresAt); err != nil {
		logger.Error("Failed to track offer in Redis", zap.Error(err))
	}

	msg := &websocket.Message{
		Type:      "ride.offer",
		RideID:    event.RideID.String(),
		UserID:    driver.UserID.String(),
		Timestamp: time.Now(),
		Data: map[string]interface{}{
			"ride_id":            offer.RideID.String(),
			"rider_name":         offer.RiderName,
			"rider_rating":       offer.RiderRating,
			"pickup_location":    offer.PickupLocation,
			"dropoff_location":   offer.DropoffLocation,
			"ride_type":          offer.RideType,
			"estimated_fare":     offer.EstimatedFare,
			"estimated_distance": offer.EstimatedDistance,
			"estimated_duration": offer.EstimatedDuration,
			"distance_to_pickup": offer.DistanceToPickup,
			"eta_to_pickup":      offer.ETAToPickup,
			"currency":           offer.Currency,
			"expires_at":         offer.ExpiresAt.Format(time.RFC3339),
			"timeout_seconds":    offer.TimeoutSeconds,
		},
	}

	s.wsHub.SendToUser(driver.UserID.String(), msg)

	logger.Info("Sent ride offer to driver",
		zap.String("ride_id", event.RideID.String()),
		zap.String("driver_id", driver.DriverID.String()),
		zap.Float64("distance_km", driver.Distance))
}

func (s *Service) trackOffer(ctx context.Context, rideID, driverID uuid.UUID, expiresAt time.Time) error {
	tracking := OfferTracking{
		DriverID:  driverID,
		SentAt:    time.Now(),
		ExpiresAt: expiresAt,
	}

	data, err := json.Marshal(tracking)
	if err != nil {
		return fmt.Errorf("failed to marshal tracking data: %w", err)
	}

	key := fmt.Sprintf("ride_offer:%s:%s", rideID.String(), driverID.String())
	ttl := time.Until(expiresAt)

	return s.redis.SetWithExpiration(ctx, key, string(data), ttl)
}

func (s *Service) onRideAccepted(ctx context.Context, event *RideAcceptedEvent) {
	logger.Info("Ride accepted, cleaning up pending offers",
		zap.String("ride_id", event.RideID.String()),
		zap.String("driver_id", event.DriverID.String()))

	if err := s.cancelPendingOffers(ctx, event.RideID, event.DriverID); err != nil {
		logger.Error("Failed to cancel pending offers", zap.Error(err))
	}
}

func (s *Service) onRideCancelled(ctx context.Context, event *RideCancelledEvent) {
	logger.Info("Ride cancelled, cleaning up pending offers",
		zap.String("ride_id", event.RideID.String()),
		zap.String("reason", event.Reason))

	if err := s.cancelPendingOffers(ctx, event.RideID, uuid.Nil); err != nil {
		logger.Error("Failed to cancel pending offers", zap.Error(err))
	}
}

func (s *Service) cancelPendingOffers(ctx context.Context, rideID, acceptedDriverID uuid.UUID) error {

	logger.Info("Ride accepted/cancelled, pending offers will auto-expire",
		zap.String("ride_id", rideID.String()))

	return nil
}

func (s *Service) isRidePending(ctx context.Context, rideID uuid.UUID) (bool, error) {
	key := fmt.Sprintf("ride_status:%s", rideID.String())
	status, err := s.redis.GetString(ctx, key)
	if err != nil {
		ride, err := s.ridesRepo.GetRideByID(ctx, rideID)
		if err != nil {
			return false, fmt.Errorf("failed to get ride from database: %w", err)
		}

		if ride == nil {
			return false, nil
		}

		return true, nil
	}

	return status == "pending" || status == "searching", nil
}
