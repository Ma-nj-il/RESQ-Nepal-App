package geo

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/common"
	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	redisClient "github.com/bikky-kc013/medi-ambulance/pkg/redis"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

const (
	driverLocationPrefix = "driver:location:"
	driverLocationTTL    = 5 * time.Minute
	driverGeoIndexKey    = "drivers:geo:index"
	driverStatusPrefix   = "driver:status:"
	searchRadiusKm       = 10.0

	h3CellDriversPrefix = "h3:drivers:"
	h3CellDriversTTL    = 5 * time.Minute
	h3SurgePrefix       = "h3:surge:"
	h3DemandPrefix      = "h3:demand:"
)

type DriverLocation struct {
	DriverID  uuid.UUID `json:"driver_id"`
	Latitude  float64   `json:"latitude"`
	Longitude float64   `json:"longitude"`
	H3Cell    string    `json:"h3_cell"`
	Heading   float64   `json:"heading,omitempty"`
	Speed     float64   `json:"speed,omitempty"`
	Status    string    `json:"status,omitempty"`
	Timestamp time.Time `json:"timestamp"`
}

type SurgeInfo struct {
	H3Cell          string    `json:"h3_cell"`
	SurgeMultiplier float64   `json:"surge_multiplier"`
	DemandCount     int       `json:"demand_count"`
	SupplyCount     int       `json:"supply_count"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type DemandInfo struct {
	H3Cell       string  `json:"h3_cell"`
	RequestCount int     `json:"request_count"`
	Latitude     float64 `json:"latitude"`
	Longitude    float64 `json:"longitude"`
}

type Service struct {
	redis          redisClient.ClientInterface
	locationBuffer *LocationBuffer
	etaTracker     *ETATracker
}

func NewService(redis redisClient.ClientInterface) *Service {
	return &Service{redis: redis}
}

func (s *Service) SetLocationBuffer(lb *LocationBuffer) {
	s.locationBuffer = lb
}

func (s *Service) SetETATracker(tracker *ETATracker) {
	s.etaTracker = tracker
}

func (s *Service) UpdateDriverLocation(ctx context.Context, driverID uuid.UUID, latitude, longitude float64) error {
	return s.UpdateDriverLocationFull(ctx, driverID, latitude, longitude, 0, 0)
}

func (s *Service) UpdateDriverLocationFull(ctx context.Context, driverID uuid.UUID, latitude, longitude, heading, speed float64) error {
	h3Cell := GetMatchingCell(latitude, longitude)
	if s.etaTracker != nil {
		go s.etaTracker.OnDriverLocationUpdate(ctx, driverID, latitude, longitude, heading, speed)
	}

	if s.locationBuffer != nil {
		s.locationBuffer.Enqueue(LocationUpdate{
			DriverID:  driverID,
			Latitude:  latitude,
			Longitude: longitude,
			Heading:   heading,
			Speed:     speed,
			H3Cell:    h3Cell,
			Timestamp: time.Now(),
		})
		return nil
	}

	location := &DriverLocation{
		DriverID:  driverID,
		Latitude:  latitude,
		Longitude: longitude,
		H3Cell:    h3Cell,
		Heading:   heading,
		Speed:     speed,
		Timestamp: time.Now(),
	}
	data, err := json.Marshal(location)
	if err != nil {
		return common.NewInternalServerError("failed to marshal location data")
	}
	key := fmt.Sprintf("%s%s", driverLocationPrefix, driverID.String())
	if err := s.redis.SetWithExpiration(ctx, key, data, driverLocationTTL); err != nil {
		return common.NewInternalServerError("failed to update driver location")
	}

	if err := s.redis.GeoAdd(ctx, driverGeoIndexKey, longitude, latitude, driverID.String()); err != nil {
		return common.NewInternalServerError("failed to add driver to geo index")
	}

	s.updateDriverH3Cell(ctx, driverID, h3Cell)

	return nil
}

func (s *Service) updateDriverH3Cell(ctx context.Context, driverID uuid.UUID, newCell string) {
	driverIDStr := driverID.String()
	prevCellKey := fmt.Sprintf("driver:h3cell:%s", driverIDStr)

	prevCell, err := s.redis.GetString(ctx, prevCellKey)
	if err == nil && prevCell != "" && prevCell != newCell {
		oldSetKey := fmt.Sprintf("%s%s:%s", h3CellDriversPrefix, prevCell, driverIDStr)
		s.redis.Delete(ctx, oldSetKey)
	}

	s.redis.SetWithExpiration(ctx, prevCellKey, []byte(newCell), driverLocationTTL)

	newSetKey := fmt.Sprintf("%s%s:%s", h3CellDriversPrefix, newCell, driverIDStr)
	s.redis.SetWithExpiration(ctx, newSetKey, []byte(driverIDStr), h3CellDriversTTL)
}

func (s *Service) GetDriverLocation(ctx context.Context, driverID uuid.UUID) (*DriverLocation, error) {
	key := fmt.Sprintf("%s%s", driverLocationPrefix, driverID.String())
	data, err := s.redis.GetString(ctx, key)
	if err != nil {
		return nil, common.NewNotFoundError("driver location not found", nil)
	}

	var location DriverLocation
	if err := json.Unmarshal([]byte(data), &location); err != nil {
		return nil, common.NewInternalServerError("failed to unmarshal location data")
	}

	return &location, nil
}

func (s *Service) FindNearbyDrivers(ctx context.Context, latitude, longitude float64, maxDrivers int) ([]*DriverLocation, error) {
	driverIDs, err := s.redis.GeoRadius(ctx, driverGeoIndexKey, longitude, latitude, searchRadiusKm, maxDrivers*2)
	if err != nil {
		return nil, common.NewInternalErrorWithError("failed to search nearby drivers", err)
	}

	if len(driverIDs) == 0 {
		return []*DriverLocation{}, nil
	}
	locationKeys := make([]string, 0, len(driverIDs))
	validDriverIDs := make([]uuid.UUID, 0, len(driverIDs))

	for _, driverIDStr := range driverIDs {
		driverID, err := uuid.Parse(driverIDStr)
		if err != nil {
			continue
		}

		locationKeys = append(locationKeys, fmt.Sprintf("%s%s", driverLocationPrefix, driverIDStr))
		validDriverIDs = append(validDriverIDs, driverID)
	}
	locationData, err := s.redis.MGetStrings(ctx, locationKeys...)
	if err != nil {
		return nil, common.NewInternalErrorWithError("failed to batch fetch driver locations", err)
	}

	type driverWithDistance struct {
		location *DriverLocation
		distance float64
	}
	var drivers []driverWithDistance
	for i, data := range locationData {
		if data == "" {
			continue
		}

		var location DriverLocation
		if err := json.Unmarshal([]byte(data), &location); err != nil {
			continue
		}
		if location.DriverID == uuid.Nil && i < len(validDriverIDs) {
			location.DriverID = validDriverIDs[i]
		}
		distance := s.CalculateDistance(latitude, longitude, location.Latitude, location.Longitude)
		if distance <= searchRadiusKm {
			drivers = append(drivers, driverWithDistance{location: &location, distance: distance})
		}
	}
	sort.Slice(drivers, func(i, j int) bool {
		return drivers[i].distance < drivers[j].distance
	})

	locations := make([]*DriverLocation, 0, maxDrivers)
	for i, d := range drivers {
		if i >= maxDrivers {
			break
		}
		locations = append(locations, d.location)
	}
	return locations, nil
}

func (s *Service) SetDriverStatus(ctx context.Context, driverID uuid.UUID, status string) error {
	key := fmt.Sprintf("%s%s", driverStatusPrefix, driverID.String())
	data := map[string]interface{}{
		"status":    status,
		"timestamp": time.Now(),
	}

	jsonData, err := json.Marshal(data)
	if err != nil {
		return common.NewInternalErrorWithError("failed to marshal status", err)
	}

	if err := s.redis.SetWithExpiration(ctx, key, jsonData, driverLocationTTL); err != nil {
		return common.NewInternalErrorWithError("failed to set driver status", err)
	}

	if status == "offline" {
		s.redis.GeoRemove(ctx, driverGeoIndexKey, driverID.String())
		prevCellKey := fmt.Sprintf("driver:h3cell:%s", driverID.String())
		s.redis.Delete(ctx, prevCellKey)
	}

	return nil
}

func (s *Service) GetDriverStatus(ctx context.Context, driverID uuid.UUID) (string, error) {
	key := fmt.Sprintf("%s%s", driverStatusPrefix, driverID.String())
	data, err := s.redis.GetString(ctx, key)
	if err != nil {
		return "offline", nil
	}

	var statusData map[string]interface{}
	if err := json.Unmarshal([]byte(data), &statusData); err != nil {
		return "offline", nil
	}

	if status, ok := statusData["status"].(string); ok {
		return status, nil
	}

	return "offline", nil
}

func (s *Service) FindAvailableDrivers(ctx context.Context, latitude, longitude float64, maxDrivers int) ([]*DriverLocation, error) {
	nearbyDrivers, err := s.FindNearbyDrivers(ctx, latitude, longitude, maxDrivers*2)
	if err != nil {
		return nil, err
	}
	if len(nearbyDrivers) == 0 {
		return []*DriverLocation{}, nil
	}
	statusKeys := make([]string, len(nearbyDrivers))
	for i, driver := range nearbyDrivers {
		statusKeys[i] = fmt.Sprintf("%s%s", driverStatusPrefix, driver.DriverID.String())
	}
	fmt.Printf("%+v\n", statusKeys)
	statusData, err := s.redis.MGetStrings(ctx, statusKeys...)
	if err != nil {
		logger.WarnContext(ctx, "batch status fetch failed, falling back to individual lookups", zap.Error(err))
		return s.findAvailableDriversFallback(ctx, nearbyDrivers, maxDrivers)
	}

	availableDrivers := make([]*DriverLocation, 0, maxDrivers)
	for i, driver := range nearbyDrivers {
		if i >= len(statusData) {
			break
		}

		status := s.parseDriverStatus(statusData[i])
		if status == "available" {
			driver.Status = status
			availableDrivers = append(availableDrivers, driver)
			if len(availableDrivers) >= maxDrivers {
				break
			}
		}
	}

	return availableDrivers, nil
}

func (s *Service) parseDriverStatus(data string) string {
	if data == "" {
		return "offline"
	}

	var statusData map[string]interface{}
	if err := json.Unmarshal([]byte(data), &statusData); err != nil {
		return "offline"
	}

	if status, ok := statusData["status"].(string); ok {
		return status
	}

	return "offline"
}

func (s *Service) findAvailableDriversFallback(ctx context.Context, nearbyDrivers []*DriverLocation, maxDrivers int) ([]*DriverLocation, error) {
	var availableDrivers []*DriverLocation
	for _, driver := range nearbyDrivers {
		status, err := s.GetDriverStatus(ctx, driver.DriverID)
		if err != nil || status != "available" {
			continue
		}

		driver.Status = status
		availableDrivers = append(availableDrivers, driver)
		if len(availableDrivers) >= maxDrivers {
			break
		}
	}

	if availableDrivers == nil {
		availableDrivers = []*DriverLocation{}
	}

	return availableDrivers, nil
}

func (s *Service) GetSurgeInfo(ctx context.Context, latitude, longitude float64) (*SurgeInfo, error) {
	surgeZone := GetSurgeZone(latitude, longitude)
	key := fmt.Sprintf("%s%s", h3SurgePrefix, surgeZone)

	data, err := s.redis.GetString(ctx, key)
	if err != nil {
		return &SurgeInfo{
			H3Cell:          surgeZone,
			SurgeMultiplier: 1.0,
			DemandCount:     0,
			SupplyCount:     0,
			UpdatedAt:       time.Now(),
		}, nil
	}

	var info SurgeInfo
	if err := json.Unmarshal([]byte(data), &info); err != nil {
		return nil, common.NewInternalServerError("failed to unmarshal surge data")
	}

	return &info, nil
}

func (s *Service) UpdateSurgeInfo(ctx context.Context, latitude, longitude float64, demandCount, supplyCount int) error {
	surgeZone := GetSurgeZone(latitude, longitude)
	multiplier := calculateSurgeMultiplier(demandCount, supplyCount)

	info := &SurgeInfo{
		H3Cell:          surgeZone,
		SurgeMultiplier: multiplier,
		DemandCount:     demandCount,
		SupplyCount:     supplyCount,
		UpdatedAt:       time.Now(),
	}

	data, err := json.Marshal(info)
	if err != nil {
		return common.NewInternalServerError("failed to marshal surge data")
	}

	key := fmt.Sprintf("%s%s", h3SurgePrefix, surgeZone)
	return s.redis.SetWithExpiration(ctx, key, data, 5*time.Minute)
}

func (s *Service) IncrementDemand(ctx context.Context, latitude, longitude float64) {
	demandZone := GetDemandZone(latitude, longitude)
	key := fmt.Sprintf("%s%s", h3DemandPrefix, demandZone)

	data, err := s.redis.GetString(ctx, key)
	count := 0
	if err == nil {
		var info DemandInfo
		if json.Unmarshal([]byte(data), &info) == nil {
			count = info.RequestCount
		}
	}

	centerLatitude, centerLongitude := CellToLatLng(LatLngToCell(latitude, longitude, H3ResolutionDemand))
	info := &DemandInfo{
		H3Cell:       demandZone,
		RequestCount: count + 1,
		Latitude:     centerLatitude,
		Longitude:    centerLongitude,
	}

	jsonData, err := json.Marshal(info)
	if err != nil {
		logger.WarnContext(ctx, "failed to marshal demand data", zap.Error(err))
		return
	}

	s.redis.SetWithExpiration(ctx, key, jsonData, 15*time.Minute)
}

func (s *Service) GetDemandHeatmap(ctx context.Context, latitude, longitude float64) ([]*DemandInfo, error) {
	cells := GetKRingCellStrings(latitude, longitude, H3ResolutionDemand, 3)
	heatmap := make([]*DemandInfo, 0)

	for _, cellStr := range cells {
		key := fmt.Sprintf("%s%s", h3DemandPrefix, cellStr)
		data, err := s.redis.GetString(ctx, key)
		if err != nil {
			continue
		}

		var info DemandInfo
		if err := json.Unmarshal([]byte(data), &info); err != nil {
			continue
		}

		if info.RequestCount > 0 {
			heatmap = append(heatmap, &info)
		}
	}

	return heatmap, nil
}

func (s *Service) CalculateDistance(latitude1, longitude1, latitude2, longitude2 float64) float64 {
	const earthRadius = 6371.0

	deltaLatitude := (latitude2 - latitude1) * math.Pi / 180.0
	deltaLongitude := (longitude2 - longitude1) * math.Pi / 180.0

	a := math.Sin(deltaLatitude/2)*math.Sin(deltaLatitude/2) +
		math.Cos(latitude1*math.Pi/180.0)*math.Cos(latitude2*math.Pi/180.0)*
			math.Sin(deltaLongitude/2)*math.Sin(deltaLongitude/2)

	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	distance := earthRadius * c

	return math.Round(distance*100) / 100
}

func (s *Service) CalculateETA(distance float64) int {
	const averageSpeed = 40.0
	eta := (distance / averageSpeed) * 60
	return int(math.Round(eta))
}

func calculateSurgeMultiplier(demand, supply int) float64 {
	if supply == 0 {
		if demand == 0 {
			return 1.0
		}
		return 3.0
	}

	ratio := float64(demand) / float64(supply)

	switch {
	case ratio <= 1.0:
		return 1.0
	case ratio <= 1.5:
		return 1.0 + (ratio-1.0)*0.5
	case ratio <= 2.0:
		return 1.25 + (ratio-1.5)*0.75
	case ratio <= 3.0:
		return 1.625 + (ratio-2.0)*0.625
	default:
		surge := 2.25 + (ratio-3.0)*0.25
		if surge > 3.0 {
			surge = 3.0
		}
		return math.Round(surge*100) / 100
	}
}

type DriverSessionSummary struct {
	OnlineDurationMinutes int       `json:"online_duration_minutes"`
	StartedAt             time.Time `json:"started_at"`
	EndedAt               time.Time `json:"ended_at"`
}

func (s *Service) ValidateDriverEligibility(ctx context.Context, driverID uuid.UUID) error {
	logger.DebugContext(ctx, "driver eligibility check passed (MVP mode)",
		zap.String("driver_id", driverID.String()))

	return nil
}

func (s *Service) TrackDriverSessionStart(ctx context.Context, driverID uuid.UUID) error {
	key := fmt.Sprintf("driver:session:%s", driverID.String())

	sessionData := map[string]interface{}{
		"started_at": time.Now().Unix(),
		"status":     "active",
	}

	data, err := json.Marshal(sessionData)
	if err != nil {
		return fmt.Errorf("failed to marshal session data: %w", err)
	}

	if err := s.redis.SetWithExpiration(ctx, key, data, 24*time.Hour); err != nil {
		return fmt.Errorf("failed to store session data: %w", err)
	}

	logger.InfoContext(ctx, "driver session started",
		zap.String("driver_id", driverID.String()))

	return nil
}

func (s *Service) EndDriverSession(ctx context.Context, driverID uuid.UUID) (*DriverSessionSummary, error) {
	key := fmt.Sprintf("driver:session:%s", driverID.String())

	data, err := s.redis.GetString(ctx, key)
	if err != nil {
		logger.WarnContext(ctx, "no active session found for driver",
			zap.String("driver_id", driverID.String()))
		return nil, nil
	}

	var sessionData map[string]interface{}
	if err := json.Unmarshal([]byte(data), &sessionData); err != nil {
		return nil, fmt.Errorf("failed to unmarshal session data: %w", err)
	}

	endTime := time.Now()
	var startTime time.Time

	if startUnix, ok := sessionData["started_at"].(float64); ok {
		startTime = time.Unix(int64(startUnix), 0)
	} else {
		startTime = endTime
	}

	duration := endTime.Sub(startTime)
	durationMinutes := int(duration.Minutes())

	summary := &DriverSessionSummary{
		OnlineDurationMinutes: durationMinutes,
		StartedAt:             startTime,
		EndedAt:               endTime,
	}

	s.redis.Delete(ctx, key)

	logger.InfoContext(ctx, "driver session ended",
		zap.String("driver_id", driverID.String()),
		zap.Int("duration_minutes", durationMinutes))

	return summary, nil
}
