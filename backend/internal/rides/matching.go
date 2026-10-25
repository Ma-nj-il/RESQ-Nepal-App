package rides

import (
	"context"
	"math"
	"sort"

	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

type MatchingConfig struct {
	DistanceWeight   float64 // How much distance matters (default 0.40)
	RatingWeight     float64 // How much driver rating matters (default 0.25)
	AcceptanceWeight float64 // How much acceptance rate matters (default 0.20)
	IdleTimeWeight   float64 // How much idle time matters (default 0.15)
	MaxDistanceKm    float64 // Max distance to consider (default 10km)
	MaxCandidates    int     // Max candidates to evaluate (default 50)
	MaxResults       int     // Max results to return (default 5)
}

// DefaultMatchingConfig returns production-tuned matching weights.
func DefaultMatchingConfig() MatchingConfig {
	return MatchingConfig{
		DistanceWeight:   0.40,
		RatingWeight:     0.25,
		AcceptanceWeight: 0.20,
		IdleTimeWeight:   0.15,
		MaxDistanceKm:    10.0,
		MaxCandidates:    50,
		MaxResults:       5,
	}
}

type DriverCandidate struct {
	DriverID       uuid.UUID `json:"driver_id"`
	DistanceKm     float64   `json:"distance_km"`
	Rating         float64   `json:"rating"`
	AcceptanceRate float64   `json:"acceptance_rate"`
	IdleMinutes    float64   `json:"idle_minutes"`
	Score          float64   `json:"score"`
}

type DriverDataProvider interface {
	GetNearbyDriverCandidates(ctx context.Context, latitude, longitude float64, maxDistance float64, limit int) ([]*DriverCandidate, error)
}

type Matcher struct {
	cfg      MatchingConfig
	provider DriverDataProvider
}

func NewMatcher(cfg MatchingConfig, provider DriverDataProvider) *Matcher {
	return &Matcher{cfg: cfg, provider: provider}
}

func (m *Matcher) FindBestDrivers(ctx context.Context, pickupLatitude, pickupLongitude float64) ([]*DriverCandidate, error) {
	candidates, err := m.provider.GetNearbyDriverCandidates(ctx, pickupLatitude, pickupLongitude, m.cfg.MaxDistanceKm, m.cfg.MaxCandidates)
	if err != nil {
		return nil, err
	}
	if len(candidates) == 0 {
		return []*DriverCandidate{}, nil
	}

	maxDist := 0.0
	maxIdle := 0.0
	for _, c := range candidates {
		if c.DistanceKm > maxDist {
			maxDist = c.DistanceKm
		}
		if c.IdleMinutes > maxIdle {
			maxIdle = c.IdleMinutes
		}
	}

	for _, c := range candidates {
		c.Score = m.scoreCandidate(c, maxDist, maxIdle)
	}

	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].Score > candidates[j].Score
	})

	if len(candidates) > m.cfg.MaxResults {
		candidates = candidates[:m.cfg.MaxResults]
	}

	logger.DebugContext(ctx, "driver matching completed",
		zap.Int("candidates_evaluated", len(candidates)),
		zap.Float64("pickup_latitude", pickupLatitude),
		zap.Float64("pickup_longitude", pickupLongitude),
	)

	return candidates, nil
}

func (m *Matcher) scoreCandidate(c *DriverCandidate, maxDist, maxIdle float64) float64 {
	distScore := 1.0
	if maxDist > 0 {
		distScore = 1.0 - (c.DistanceKm / maxDist)
	}

	ratingScore := (c.Rating - 1.0) / 4.0
	if ratingScore < 0 {
		ratingScore = 0
	}

	acceptScore := c.AcceptanceRate

	// Idle time score: longer idle = higher priority (fairness).
	// Use logarithmic scaling to prevent extreme values from dominating.
	idleScore := 0.0
	if maxIdle > 0 && c.IdleMinutes > 0 {
		idleScore = math.Log1p(c.IdleMinutes) / math.Log1p(maxIdle)
	}

	score := m.cfg.DistanceWeight*distScore +
		m.cfg.RatingWeight*ratingScore +
		m.cfg.AcceptanceWeight*acceptScore +
		m.cfg.IdleTimeWeight*idleScore

	return math.Round(score*1000) / 1000
}
