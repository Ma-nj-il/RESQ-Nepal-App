package maps

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"sync"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/config"
	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	redisclient "github.com/bikky-kc013/medi-ambulance/pkg/redis"
	"github.com/bikky-kc013/medi-ambulance/pkg/resilience"
	"go.uber.org/zap"
)

type Service struct {
	primary         MapsProvider
	fallbacks       []MapsProvider
	redis           redisclient.ClientInterface
	config          Config
	breakers        map[Provider]*resilience.CircuitBreaker
	mu              sync.RWMutex
	trafficCache    map[string]*TrafficFlowResponse
	trafficCacheTTL time.Duration
}

func NewService(config Config, redis redisclient.ClientInterface, timeOutConfig config.TimeoutConfig) (*Service, error) {
	s := &Service{
		redis:           redis,
		config:          config,
		breakers:        make(map[Provider]*resilience.CircuitBreaker),
		trafficCache:    make(map[string]*TrafficFlowResponse),
		trafficCacheTTL: time.Duration(config.TrafficRefreshSeconds) * time.Second,
	}

	primary, err := s.createProvider(config.Primary, timeOutConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create primary provider: %w", err)
	}
	s.primary = primary

	for _, fc := range config.Fallbacks {
		fallback, err := s.createProvider(fc, timeOutConfig)
		if err != nil {
			logger.Warn("Failed to create fallback provider", zap.Error(err), zap.String("provider", string(fc.Provider)))
			continue
		}
		s.fallbacks = append(s.fallbacks, fallback)
	}

	s.initCircuitBreakers()

	return s, nil
}

func (s *Service) createProvider(config ProviderConfig, timeOutConfig config.TimeoutConfig) (MapsProvider, error) {
	switch config.Provider {
	case ProviderGoogle:
		return NewGoogleMapsProvider(config, timeOutConfig), nil
	case ProviderHERE:
		return NewHEREMapsProvider(config, timeOutConfig), nil
	default:
		return nil, fmt.Errorf("unsupported provider: %s", config.Provider)
	}
}

func (s *Service) initCircuitBreakers() {
	s.breakers[s.primary.Name()] = resilience.NewCircuitBreaker(
		resilience.BuildSettings(
			fmt.Sprintf("maps-%s", s.primary.Name()),
			60,
			30,
			5,
			2,
		),
		nil,
	)

	for _, fb := range s.fallbacks {
		s.breakers[fb.Name()] = resilience.NewCircuitBreaker(
			resilience.BuildSettings(
				fmt.Sprintf("maps-%s", fb.Name()),
				60, 30, 5, 2,
			),
			nil,
		)
	}
}

func (s *Service) GetRoute(ctx context.Context, req *RouteRequest) (*RouteResponse, error) {
	if s.config.CacheEnabled {
		cacheKey := s.routeCacheKey(req)
		if cached, err := s.getFromCache(ctx, cacheKey); err == nil {
			var resp RouteResponse
			if err := json.Unmarshal(cached, &resp); err == nil {
				resp.CacheHit = true
				return &resp, nil
			}
		}
	}

	resp, err := s.executeWithFallback(ctx, func(ctx context.Context, provider MapsProvider) (interface{}, error) {
		return provider.GetRoute(ctx, req)
	})

	if err != nil {
		return nil, err
	}

	routeResp, ok := resp.(*RouteResponse)
	if !ok {
		return nil, fmt.Errorf("unexpected response type: %T", resp)
	}

	if s.config.CacheEnabled && len(routeResp.Routes) > 0 {
		cacheKey := s.routeCacheKey(req)
		if data, err := json.Marshal(routeResp); err == nil {
			_ = s.setCache(ctx, cacheKey, data, time.Duration(s.config.CacheTTLSeconds)*time.Second)
		}
	}

	return routeResp, nil
}

func (s *Service) GetETA(ctx context.Context, req *ETARequest) (*ETAResponse, error) {
	if s.config.CacheEnabled {
		cacheKey := s.etaCacheKey(req)
		if cached, err := s.getFromCache(ctx, cacheKey); err == nil {
			var resp ETAResponse
			if err := json.Unmarshal(cached, &resp); err == nil {
				resp.CacheHit = true
				return &resp, nil
			}
		}
	}

	resp, err := s.executeWithFallback(ctx, func(ctx context.Context, provider MapsProvider) (interface{}, error) {
		return provider.GetETA(ctx, req)
	})

	if err != nil {
		return s.fallbackETA(req), nil
	}

	etaResp, ok := resp.(*ETAResponse)
	if !ok {
		return nil, fmt.Errorf("unexpected response type: %T", resp)
	}

	if s.config.CacheEnabled {
		cacheKey := s.etaCacheKey(req)
		if data, err := json.Marshal(etaResp); err == nil {
			_ = s.setCache(ctx, cacheKey, data, 2*time.Minute)
		}
	}

	return etaResp, nil
}

func (s *Service) GetDistanceMatrix(ctx context.Context, req *DistanceMatrixRequest) (*DistanceMatrixResponse, error) {
	resp, err := s.executeWithFallback(ctx, func(ctx context.Context, provider MapsProvider) (interface{}, error) {
		return provider.GetDistanceMatrix(ctx, req)
	})

	if err != nil {
		return nil, err
	}

	matrixResp, ok := resp.(*DistanceMatrixResponse)
	if !ok {
		return nil, fmt.Errorf("unexpected response type: %T", resp)
	}

	return matrixResp, nil
}

func (s *Service) GetTrafficFlow(ctx context.Context, req *TrafficFlowRequest) (*TrafficFlowResponse, error) {
	cacheKey := s.trafficCacheKey(req)
	s.mu.RLock()
	if cached, ok := s.trafficCache[cacheKey]; ok {
		s.mu.RUnlock()
		return cached, nil
	}
	s.mu.RUnlock()

	resp, err := s.executeWithFallback(ctx, func(ctx context.Context, provider MapsProvider) (interface{}, error) {
		return provider.GetTrafficFlow(ctx, req)
	})

	if err != nil {
		return &TrafficFlowResponse{
			OverallLevel: TrafficModerate,
			UpdatedAt:    time.Now(),
		}, nil
	}

	trafficResp, ok := resp.(*TrafficFlowResponse)
	if !ok {
		return nil, fmt.Errorf("unexpected response type: %T", resp)
	}

	s.mu.Lock()
	s.trafficCache[cacheKey] = trafficResp
	s.mu.Unlock()

	go func() {
		time.Sleep(s.trafficCacheTTL)
		s.mu.Lock()
		delete(s.trafficCache, cacheKey)
		s.mu.Unlock()
	}()

	return trafficResp, nil
}

func (s *Service) GetTrafficIncidents(ctx context.Context, req *TrafficIncidentsRequest) (*TrafficIncidentsResponse, error) {
	resp, err := s.executeWithFallback(ctx, func(ctx context.Context, provider MapsProvider) (interface{}, error) {
		return provider.GetTrafficIncidents(ctx, req)
	})

	if err != nil {
		return &TrafficIncidentsResponse{
			Incidents: []TrafficIncident{},
			UpdatedAt: time.Now(),
		}, nil
	}

	incidentsResp, ok := resp.(*TrafficIncidentsResponse)
	if !ok {
		return nil, fmt.Errorf("unexpected response type: %T", resp)
	}

	return incidentsResp, nil
}

func (s *Service) Geocode(ctx context.Context, req *GeocodingRequest) (*GeocodingResponse, error) {
	if s.config.CacheEnabled {
		cacheKey := s.geocodeCacheKey(req)
		if cached, err := s.getFromCache(ctx, cacheKey); err == nil {
			var resp GeocodingResponse
			if err := json.Unmarshal(cached, &resp); err == nil {
				return &resp, nil
			}
		}
	}

	resp, err := s.executeWithFallback(ctx, func(ctx context.Context, provider MapsProvider) (interface{}, error) {
		return provider.Geocode(ctx, req)
	})

	if err != nil {
		return nil, err
	}

	geoResp, ok := resp.(*GeocodingResponse)
	if !ok {
		return nil, fmt.Errorf("unexpected response type: %T", resp)
	}

	if s.config.CacheEnabled && len(geoResp.Results) > 0 {
		cacheKey := s.geocodeCacheKey(req)
		if data, err := json.Marshal(geoResp); err == nil {
			_ = s.setCache(ctx, cacheKey, data, 24*time.Hour)
		}
	}

	return geoResp, nil
}

func (s *Service) ReverseGeocode(ctx context.Context, req *GeocodingRequest) (*GeocodingResponse, error) {
	if s.config.CacheEnabled && req.Coordinate != nil {
		cacheKey := s.reverseGeocodeCacheKey(req)
		if cached, err := s.getFromCache(ctx, cacheKey); err == nil {
			var resp GeocodingResponse
			if err := json.Unmarshal(cached, &resp); err == nil {
				return &resp, nil
			}
		}
	}

	resp, err := s.executeWithFallback(ctx, func(ctx context.Context, provider MapsProvider) (interface{}, error) {
		return provider.ReverseGeocode(ctx, req)
	})

	if err != nil {
		return nil, err
	}

	geoResp, ok := resp.(*GeocodingResponse)
	if !ok {
		return nil, fmt.Errorf("unexpected response type: %T", resp)
	}

	if s.config.CacheEnabled && len(geoResp.Results) > 0 && req.Coordinate != nil {
		cacheKey := s.reverseGeocodeCacheKey(req)
		if data, err := json.Marshal(geoResp); err == nil {
			_ = s.setCache(ctx, cacheKey, data, 24*time.Hour)
		}
	}

	return geoResp, nil
}

func (s *Service) SearchPlaces(ctx context.Context, req *PlaceSearchRequest) (*PlaceSearchResponse, error) {
	resp, err := s.executeWithFallback(ctx, func(ctx context.Context, provider MapsProvider) (interface{}, error) {
		return provider.SearchPlaces(ctx, req)
	})

	if err != nil {
		return nil, err
	}

	placesResp, ok := resp.(*PlaceSearchResponse)
	if !ok {
		return nil, fmt.Errorf("unexpected response type: %T", resp)
	}

	return placesResp, nil
}

func (s *Service) SnapToRoad(ctx context.Context, req *SnapToRoadRequest, timeOutConfig config.TimeoutConfig) (*SnapToRoadResponse, error) {
	resp, err := s.executeWithFallback(ctx, func(ctx context.Context, provider MapsProvider) (interface{}, error) {
		return provider.SnapToRoad(ctx, req, timeOutConfig)
	})

	if err != nil {
		return nil, err
	}

	snapResp, ok := resp.(*SnapToRoadResponse)
	if !ok {
		return nil, fmt.Errorf("unexpected response type: %T", resp)
	}

	return snapResp, nil
}

func (s *Service) GetSpeedLimits(ctx context.Context, req *SpeedLimitsRequest, timeOutConfig config.TimeoutConfig) (*SpeedLimitsResponse, error) {
	resp, err := s.executeWithFallback(ctx, func(ctx context.Context, provider MapsProvider) (interface{}, error) {
		return provider.GetSpeedLimits(ctx, req, timeOutConfig)
	})

	if err != nil {
		return nil, err
	}

	speedResp, ok := resp.(*SpeedLimitsResponse)
	if !ok {
		return nil, fmt.Errorf("unexpected response type: %T", resp)
	}

	return speedResp, nil
}

func (s *Service) HealthCheck(ctx context.Context) map[Provider]error {
	results := make(map[Provider]error)

	results[s.primary.Name()] = s.primary.HealthCheck(ctx)

	for _, fb := range s.fallbacks {
		results[fb.Name()] = fb.HealthCheck(ctx)
	}

	return results
}

func (s *Service) GetPrimaryProvider() Provider {
	return s.primary.Name()
}

func (s *Service) executeWithFallback(ctx context.Context, fn func(context.Context, MapsProvider) (interface{}, error)) (interface{}, error) {
	providers := append([]MapsProvider{s.primary}, s.fallbacks...)

	var lastErr error
	for _, provider := range providers {
		breaker := s.breakers[provider.Name()]
		if breaker == nil {
			result, err := fn(ctx, provider)
			if err == nil {
				return result, nil
			}
			lastErr = err
			logger.Warn("Maps provider failed", zap.Error(err), zap.String("provider", string(provider.Name())))
			continue
		}

		result, err := breaker.Execute(ctx, func(ctx context.Context) (interface{}, error) {
			return fn(ctx, provider)
		})

		if err == nil {
			return result, nil
		}

		lastErr = err
		logger.Warn("Maps provider failed", zap.Error(err), zap.String("provider", string(provider.Name())))
	}

	return nil, fmt.Errorf("all maps providers failed: %w", lastErr)
}

func (s *Service) fallbackETA(req *ETARequest) *ETAResponse {
	distance := haversineDistance(
		req.Origin.Latitude, req.Origin.Longitude,
		req.Destination.Latitude, req.Destination.Longitude,
	)

	const avgSpeed = 30.0
	durationMinutes := (distance / avgSpeed) * 60

	durationMinutes *= 1.2

	return &ETAResponse{
		DistanceKm:        distance,
		DistanceMeters:    int(distance * 1000),
		DurationMinutes:   durationMinutes,
		DurationSeconds:   int(durationMinutes * 60),
		DurationInTraffic: durationMinutes,
		TrafficLevel:      TrafficModerate,
		EstimatedArrival:  time.Now().Add(time.Duration(durationMinutes) * time.Minute),
		Provider:          "fallback",
		Confidence:        0.5,
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

func (s *Service) routeCacheKey(req *RouteRequest) string {
	data := fmt.Sprintf("route:%f,%f:%f,%f:%v:%v:%v",
		req.Origin.Latitude, req.Origin.Longitude,
		req.Destination.Latitude, req.Destination.Longitude,
		req.AvoidTolls, req.AvoidHighways, req.AvoidFerries,
	)
	return s.config.CachePrefix + s.hashKey(data)
}

func (s *Service) etaCacheKey(req *ETARequest) string {
	data := fmt.Sprintf("eta:%f,%f:%f,%f",
		req.Origin.Latitude, req.Origin.Longitude,
		req.Destination.Latitude, req.Destination.Longitude,
	)
	return s.config.CachePrefix + s.hashKey(data)
}

func (s *Service) geocodeCacheKey(req *GeocodingRequest) string {
	data := fmt.Sprintf("geo:%s:%s:%s", req.Address, req.Language, req.Region)
	return s.config.CachePrefix + s.hashKey(data)
}

func (s *Service) reverseGeocodeCacheKey(req *GeocodingRequest) string {
	latitude := math.Round(req.Coordinate.Latitude*100000) / 100000
	longitude := math.Round(req.Coordinate.Longitude*100000) / 100000
	data := fmt.Sprintf("rgeo:%f,%f:%s", latitude, longitude, req.Language)
	return s.config.CachePrefix + s.hashKey(data)
}

func (s *Service) trafficCacheKey(req *TrafficFlowRequest) string {
	latitude := math.Round(req.Location.Latitude*1000) / 1000
	longitude := math.Round(req.Location.Longitude*1000) / 1000
	return fmt.Sprintf("traffic:%f,%f", latitude, longitude)
}

func (s *Service) hashKey(data string) string {
	hash := sha256.Sum256([]byte(data))
	return hex.EncodeToString(hash[:8])
}

func (s *Service) getFromCache(ctx context.Context, key string) ([]byte, error) {
	if s.redis == nil {
		return nil, fmt.Errorf("redis not available")
	}

	val, err := s.redis.GetString(ctx, key)
	if err != nil {
		return nil, err
	}

	return []byte(val), nil
}

func (s *Service) setCache(ctx context.Context, key string, data []byte, ttl time.Duration) error {
	if s.redis == nil {
		return nil
	}

	return s.redis.SetWithExpiration(ctx, key, string(data), ttl)
}

func (s *Service) GetTrafficAwareETA(ctx context.Context, origin, destination Coordinate) (*ETAResponse, error) {
	trafficReq := &TrafficFlowRequest{
		Location:     origin,
		RadiusMeters: 5000,
	}

	traffic, _ := s.GetTrafficFlow(ctx, trafficReq)

	etaReq := &ETARequest{
		Origin:      origin,
		Destination: destination,
	}

	eta, err := s.GetETA(ctx, etaReq)
	if err != nil {
		return nil, err
	}

	if traffic != nil && traffic.OverallLevel != "" {
		eta.TrafficLevel = traffic.OverallLevel
	}

	return eta, nil
}

func (s *Service) BatchGetETA(ctx context.Context, requests []*ETARequest) ([]*ETAResponse, error) {
	responses := make([]*ETAResponse, len(requests))
	var wg sync.WaitGroup
	var mu sync.Mutex
	var lastErr error

	for i, req := range requests {
		wg.Add(1)
		go func(idx int, r *ETARequest) {
			defer wg.Done()

			resp, err := s.GetETA(ctx, r)
			mu.Lock()
			if err != nil {
				lastErr = err
				responses[idx] = s.fallbackETA(r)
			} else {
				responses[idx] = resp
			}
			mu.Unlock()
		}(i, req)
	}

	wg.Wait()

	if lastErr != nil {
		logger.Warn("Some batch ETA requests failed", zap.Error(lastErr))
	}

	return responses, nil
}

func (s *Service) OptimizeWaypoints(ctx context.Context, origin Coordinate, waypoints []Coordinate, destination Coordinate) ([]int, error) {
	if len(waypoints) == 0 {
		return []int{}, nil
	}

	if len(waypoints) == 1 {
		return []int{0}, nil
	}

	allPoints := append([]Coordinate{origin}, waypoints...)
	allPoints = append(allPoints, destination)

	matrixReq := &DistanceMatrixRequest{
		Origins:      allPoints,
		Destinations: allPoints,
	}

	matrix, err := s.GetDistanceMatrix(ctx, matrixReq)
	if err != nil {
		return nil, fmt.Errorf("failed to get distance matrix: %w", err)
	}

	visited := make(map[int]bool)
	order := make([]int, 0, len(waypoints))
	current := 0

	for len(order) < len(waypoints) {
		nearestIdx := -1
		nearestDist := math.MaxFloat64

		for j := 1; j <= len(waypoints); j++ {
			if visited[j-1] {
				continue
			}

			dist := matrix.Rows[current].Elements[j].DistanceKm
			if dist < nearestDist {
				nearestDist = dist
				nearestIdx = j - 1
			}
		}

		if nearestIdx >= 0 {
			visited[nearestIdx] = true
			order = append(order, nearestIdx)
			current = nearestIdx + 1
		}
	}

	return order, nil
}
