package pricing

import (
	"context"
	"math"
	"time"

	"gorm.io/gorm"
)

type SurgeCalculator struct {
	db *gorm.DB
}

func NewSurgeCalculator(db *gorm.DB) *SurgeCalculator {
	return &SurgeCalculator{db: db}
}

type SurgeFactors struct {
	DemandRatio    float64
	TimeMultiplier float64
	DayMultiplier  float64
	ZoneMultiplier float64
	WeatherFactor  float64
}

func (sc *SurgeCalculator) CalculateSurgeMultiplier(ctx context.Context, latitude, longitude float64) (float64, error) {
	factors, err := sc.getSurgeFactors(ctx, latitude, longitude)
	if err != nil {
		return calculateTimeBasedSurge(time.Now()), nil
	}

	surgeMultiplier := 1.0

	demandSurge := calculateDemandSurge(factors.DemandRatio)
	surgeMultiplier += (demandSurge - 1.0) * 0.6
	surgeMultiplier += (factors.TimeMultiplier - 1.0) * 0.2
	surgeMultiplier += (factors.DayMultiplier - 1.0) * 0.1
	surgeMultiplier += (factors.ZoneMultiplier - 1.0) * 0.1

	surgeMultiplier = math.Max(1.0, math.Min(5.0, surgeMultiplier))
	surgeMultiplier = math.Round(surgeMultiplier*10) / 10

	return surgeMultiplier, nil
}

func (sc *SurgeCalculator) getSurgeFactors(ctx context.Context, latitude, longitude float64) (*SurgeFactors, error) {
	now := time.Now()

	demandRatio, _ := sc.getDemandRatio(ctx, latitude, longitude)
	zoneMultiplier, _ := sc.getZoneMultiplier(ctx, latitude, longitude)

	return &SurgeFactors{
		DemandRatio:    demandRatio,
		TimeMultiplier: calculateTimeBasedSurge(now),
		DayMultiplier:  calculateDayBasedSurge(now),
		ZoneMultiplier: zoneMultiplier,
		WeatherFactor:  1.0,
	}, nil
}

func (sc *SurgeCalculator) getDemandRatio(ctx context.Context, latitude, longitude float64) (float64, error) {
	var requestCount int64

	err := sc.db.WithContext(ctx).Raw(`
		SELECT COUNT(*)
		FROM rides
		WHERE status IN ('requested', 'accepted')
		  AND requested_at >= NOW() - INTERVAL '15 minutes'
		  AND ST_DWithin(
			  ST_MakePoint(pickup_longitude, pickup_latitude)::geography,
			  ST_MakePoint(?, ?)::geography,
			  10000
		  )
	`, longitude, latitude).Scan(&requestCount).Error
	if err != nil {
		return 1.0, err
	}

	var driverCount int64

	err = sc.db.WithContext(ctx).Raw(`
		SELECT COUNT(DISTINCT u.id)
		FROM users u
		INNER JOIN rides r ON u.id = r.driver_id
		WHERE u.role = 'driver'
		  AND u.is_active = true
		  AND r.status = 'completed'
		  AND r.completed_at >= NOW() - INTERVAL '1 hour'
		  AND ST_DWithin(
			  ST_MakePoint(r.dropoff_longitude, r.dropoff_latitude)::geography,
			  ST_MakePoint(?, ?)::geography,
			  10000
		  )
	`, longitude, latitude).Scan(&driverCount).Error

	if err != nil || driverCount == 0 {
		driverCount = 10
	}

	ratio := float64(requestCount) / float64(driverCount)
	return ratio, nil
}

func (sc *SurgeCalculator) getZoneMultiplier(ctx context.Context, latitude, longitude float64) (float64, error) {
	var rideDensity int64

	err := sc.db.WithContext(ctx).Raw(`
		SELECT COUNT(*)
		FROM rides
		WHERE status = 'completed'
		  AND completed_at >= NOW() - INTERVAL '24 hours'
		  AND ST_DWithin(
			  ST_MakePoint(pickup_longitude, pickup_latitude)::geography,
			  ST_MakePoint(?, ?)::geography,
			  2000
		  )
	`, longitude, latitude).Scan(&rideDensity).Error

	if err != nil {
		return 1.0, err
	}

	if rideDensity > 50 {
		return 1.2, nil
	}
	if rideDensity > 20 {
		return 1.1, nil
	}

	return 1.0, nil
}

func calculateDemandSurge(demandRatio float64) float64 {
	if demandRatio < 1.0 {
		return 1.0
	}
	if demandRatio < 2.0 {
		return 1.0 + (demandRatio - 1.0)
	}
	if demandRatio < 3.0 {
		return 2.0 + (demandRatio - 2.0)
	}
	return math.Min(4.0, 3.0+math.Log10(demandRatio-2.0))
}

func calculateTimeBasedSurge(t time.Time) float64 {
	hour := t.Hour()

	if hour >= 7 && hour < 9 {
		return 1.5
	}
	if hour >= 17 && hour < 20 {
		return 1.8
	}
	if hour >= 23 || hour < 5 {
		return 1.4
	}
	if hour >= 12 && hour < 14 {
		return 1.2
	}

	return 1.0
}

func calculateDayBasedSurge(t time.Time) float64 {
	weekday := t.Weekday()

	if weekday == time.Friday || weekday == time.Saturday || weekday == time.Sunday {
		hour := t.Hour()
		if (weekday == time.Friday || weekday == time.Saturday) && hour >= 20 {
			return 1.3
		}
		return 1.2
	}

	if weekday == time.Monday && t.Hour() >= 7 && t.Hour() < 10 {
		return 1.2
	}

	return 1.0
}

func (sc *SurgeCalculator) GetCurrentSurgeInfo(ctx context.Context, latitude, longitude float64) (map[string]interface{}, error) {
	factors, err := sc.getSurgeFactors(ctx, latitude, longitude)
	if err != nil {
		return nil, err
	}

	surge, _ := sc.CalculateSurgeMultiplier(ctx, latitude, longitude)

	return map[string]interface{}{
		"surge_multiplier": surge,
		"factors": map[string]interface{}{
			"demand_ratio":    factors.DemandRatio,
			"demand_surge":    calculateDemandSurge(factors.DemandRatio),
			"time_multiplier": factors.TimeMultiplier,
			"day_multiplier":  factors.DayMultiplier,
			"zone_multiplier": factors.ZoneMultiplier,
			"weather_factor":  factors.WeatherFactor,
		},
		"is_surge_active": surge > 1.0,
		"message":         getSurgeMessage(surge),
	}, nil
}

func getSurgeMessage(surge float64) string {
	if surge >= 3.0 {
		return "Very high demand - Fares are significantly higher than normal"
	}
	if surge >= 2.0 {
		return "High demand - Fares are higher than normal"
	}
	if surge >= 1.5 {
		return "Increased demand - Fares are slightly higher"
	}
	if surge > 1.0 {
		return "Mild surge pricing active"
	}
	return "Normal pricing"
}
