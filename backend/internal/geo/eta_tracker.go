package geo

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sync"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/config"
	"github.com/bikky-kc013/medi-ambulance/pkg/httpclient"
	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	redisClient "github.com/bikky-kc013/medi-ambulance/pkg/redis"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

const (
	activeRidePrefix     = "ride:active:"
	etaUpdateMinInterval = 5 * time.Second
)

type ActiveRideInfo struct {
	RideID           uuid.UUID `json:"ride_id"`
	RiderID          uuid.UUID `json:"rider_id"`
	DriverID         uuid.UUID `json:"driver_id"`
	DropoffLatitude  float64   `json:"dropoff_latitude"`
	DropoffLongitude float64   `json:"dropoff_longitude"`
	Status           string    `json:"status"`
	PickupLatitude   float64   `json:"pickup_latitude"`
	PickupLongitude  float64   `json:"pickup_longitude"`
	LastETAUpdate    time.Time `json:"last_eta_update"`
}

type ETAUpdate struct {
	RideID          string  `json:"ride_id"`
	ETAMinutes      int     `json:"eta_minutes"`
	DistanceKm      float64 `json:"distance_km"`
	DriverLatitude  float64 `json:"driver_latitude"`
	DriverLongitude float64 `json:"driver_longitude"`
	DriverHeading   float64 `json:"driver_heading"`
	DriverSpeed     float64 `json:"driver_speed"`
	UpdatedAt       string  `json:"updated_at"`
}

type ETATracker struct {
	redis          redisClient.ClientInterface
	realtimeClient *httpclient.Client
	mu             sync.Mutex
	lastUpdate     map[string]time.Time
}

func NewETATracker(cfg config.TimeoutConfig, redis redisClient.ClientInterface, realtimeServiceURL string) *ETATracker {
	return &ETATracker{
		redis:          redis,
		realtimeClient: httpclient.NewClient(cfg, realtimeServiceURL),
		lastUpdate:     make(map[string]time.Time),
	}
}

func (t *ETATracker) RegisterActiveRide(ctx context.Context, info *ActiveRideInfo) error {
	data, err := json.Marshal(info)
	if err != nil {
		return err
	}
	key := fmt.Sprintf("%s%s", activeRidePrefix, info.DriverID.String())
	return t.redis.SetWithExpiration(ctx, key, data, 2*time.Hour)
}

func (t *ETATracker) UnregisterActiveRide(ctx context.Context, driverID uuid.UUID) {
	key := fmt.Sprintf("%s%s", activeRidePrefix, driverID.String())
	t.redis.Delete(ctx, key)

	t.mu.Lock()
	delete(t.lastUpdate, driverID.String())
	t.mu.Unlock()
}

func (t *ETATracker) OnDriverLocationUpdate(ctx context.Context, driverID uuid.UUID, latitude, longitude, heading, speed float64) {
	driverIDStr := driverID.String()
	t.mu.Lock()
	if last, ok := t.lastUpdate[driverIDStr]; ok && time.Since(last) < etaUpdateMinInterval {
		t.mu.Unlock()
		return
	}
	t.mu.Unlock()

	key := fmt.Sprintf("%s%s", activeRidePrefix, driverIDStr)
	data, err := t.redis.GetString(ctx, key)
	if err != nil {
		return
	}

	var rideInfo ActiveRideInfo
	if err := json.Unmarshal([]byte(data), &rideInfo); err != nil {
		return
	}

	destLatitude, destLongitude := rideInfo.DropoffLatitude, rideInfo.DropoffLongitude
	if rideInfo.Status == "accepted" {
		destLatitude, destLongitude = rideInfo.PickupLatitude, rideInfo.PickupLongitude
	}

	distance := haversineDistance(latitude, longitude, destLatitude, destLongitude)
	etaMinutes := estimateETAMinutes(distance, speed)

	t.mu.Lock()
	t.lastUpdate[driverIDStr] = time.Now()
	t.mu.Unlock()

	update := &ETAUpdate{
		RideID:          rideInfo.RideID.String(),
		ETAMinutes:      etaMinutes,
		DistanceKm:      math.Round(distance*100) / 100,
		DriverLatitude:  latitude,
		DriverLongitude: longitude,
		DriverHeading:   heading,
		DriverSpeed:     speed,
		UpdatedAt:       time.Now().UTC().Format(time.RFC3339),
	}

	t.broadcastETAUpdate(ctx, rideInfo.RiderID.String(), rideInfo.RideID.String(), update)
}

func (t *ETATracker) broadcastETAUpdate(ctx context.Context, riderID, rideID string, update *ETAUpdate) {
	payload := map[string]interface{}{
		"user_id": riderID,
		"type":    "eta_update",
		"data":    update,
	}

	_, err := t.realtimeClient.Post(ctx, "/api/v1/internal/broadcast/user", payload, nil)
	if err != nil {
		logger.DebugContext(ctx, "failed to broadcast ETA update", zap.Error(err))
	}

	ridePayload := map[string]interface{}{
		"ride_id": rideID,
		"data":    update,
	}
	_, err = t.realtimeClient.Post(ctx, "/api/v1/internal/broadcast/ride", ridePayload, nil)
	if err != nil {
		logger.DebugContext(ctx, "failed to broadcast ETA to ride room", zap.Error(err))
	}
}

func haversineDistance(latitude1, longitude1, latitude2, longitude2 float64) float64 {
	const earthRadius = 6371.0
	deltaLatitude := (latitude2 - latitude1) * math.Pi / 180.0
	deltaLongitude := (longitude2 - longitude1) * math.Pi / 180.0
	a := math.Sin(deltaLatitude/2)*math.Sin(deltaLatitude/2) +
		math.Cos(latitude1*math.Pi/180.0)*math.Cos(latitude2*math.Pi/180.0)*
			math.Sin(deltaLongitude/2)*math.Sin(deltaLongitude/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return earthRadius * c
}

func estimateETAMinutes(distanceKm, speedKmh float64) int {
	if speedKmh > 5 {
		eta := (distanceKm / speedKmh) * 60
		return int(math.Ceil(eta))
	}
	const avgSpeed = 30.0
	eta := (distanceKm / avgSpeed) * 60
	return int(math.Ceil(eta))
}
