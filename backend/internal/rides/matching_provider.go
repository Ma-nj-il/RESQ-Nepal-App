package rides

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/bikky-kc013/medi-ambulance/pkg/httpclient"
	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	"github.com/bikky-kc013/medi-ambulance/pkg/resilience"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

type GeoMatchingProvider struct {
	geoClient *httpclient.Client
	repo      *Repository
	breaker   *resilience.CircuitBreaker
}

func NewGeoMatchingProvider(geoClient *httpclient.Client, repo *Repository) *GeoMatchingProvider {
	return &GeoMatchingProvider{geoClient: geoClient, repo: repo}
}

func (p *GeoMatchingProvider) SetCircuitBreaker(cb *resilience.CircuitBreaker) {
	p.breaker = cb
}

type nearbyDriverResponse struct {
	DriverID  uuid.UUID `json:"driver_id"`
	Latitude  float64   `json:"latitude"`
	Longitude float64   `json:"longitude"`
	H3Cell    string    `json:"h3_cell"`
}

type geoAPIResponse struct {
	Success bool `json:"success"`
	Data    struct {
		Drivers []nearbyDriverResponse `json:"drivers"`
	} `json:"data"`
}

func (p *GeoMatchingProvider) GetNearbyDriverCandidates(ctx context.Context, latitude, longitude float64, maxDistance float64, limit int) ([]*DriverCandidate, error) {
	path := fmt.Sprintf("/api/v1/geo/drivers/nearby?latitude=%f&longitude=%f&limit=%d", latitude, longitude, limit)
	var body []byte
	var err error
	if p.breaker != nil {
		result, cbErr := p.breaker.Execute(ctx, func(ctx context.Context) (interface{}, error) {
			return p.geoClient.Get(ctx, path, nil)
		})
		if cbErr != nil {
			logger.WarnContext(ctx, "geo service call failed (circuit breaker)", zap.Error(cbErr))
			return []*DriverCandidate{}, nil
		}
		body = result.([]byte)
	} else {
		body, err = p.geoClient.Get(ctx, path, nil)
		if err != nil {
			logger.WarnContext(ctx, "failed to fetch nearby drivers from geo service", zap.Error(err))
			return []*DriverCandidate{}, nil
		}
	}
	var resp geoAPIResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse geo response: %w", err)
	}

	if len(resp.Data.Drivers) == 0 {
		return []*DriverCandidate{}, nil
	}

	driverIDs := make([]uuid.UUID, len(resp.Data.Drivers))
	for i, d := range resp.Data.Drivers {
		driverIDs[i] = d.DriverID
	}

	stats, err := p.repo.GetDriverMatchStats(ctx, driverIDs)
	if err != nil {
		logger.WarnContext(ctx, "failed to fetch driver stats, using defaults", zap.Error(err))
		stats = make(map[uuid.UUID]*DriverMatchStats)
	}

	candidates := make([]*DriverCandidate, 0, len(resp.Data.Drivers))
	for _, d := range resp.Data.Drivers {
		dist := haversine(latitude, longitude, d.Latitude, d.Longitude)
		if dist > maxDistance {
			continue
		}

		s := stats[d.DriverID]
		if s == nil {
			s = &DriverMatchStats{Rating: 4.0, AcceptanceRate: 0.8, IdleMinutes: 30.0}
		}

		candidates = append(candidates, &DriverCandidate{
			DriverID:       d.DriverID,
			DistanceKm:     dist,
			Rating:         s.Rating,
			AcceptanceRate: s.AcceptanceRate,
			IdleMinutes:    s.IdleMinutes,
		})
	}

	return candidates, nil
}

func haversine(latitude1, longitude1, latitude2, longitude2 float64) float64 {
	return calculateDistance(latitude1, longitude1, latitude2, longitude2)
}
