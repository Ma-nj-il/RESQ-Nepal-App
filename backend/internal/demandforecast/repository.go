package demandforecast

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"gorm.io/gorm"

	"github.com/google/uuid"
)

type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) RecordDemand(ctx context.Context, record *HistoricalDemandRecord) error {
	query := `
		INSERT INTO historical_demand (
			id, h3_index, timestamp, hour, day_of_week, is_holiday,
			ride_requests, completed_rides, available_drivers,
			avg_wait_time_min, surge_multiplier, weather_condition,
			temperature, precipitation_mm, special_event_type, special_event_scale,
			created_at
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
		)
		ON CONFLICT (h3_index, timestamp) DO UPDATE SET
			ride_requests = EXCLUDED.ride_requests,
			completed_rides = EXCLUDED.completed_rides,
			available_drivers = EXCLUDED.available_drivers,
			avg_wait_time_min = EXCLUDED.avg_wait_time_min,
			surge_multiplier = EXCLUDED.surge_multiplier
	`

	_, err := r.sqlDB().ExecContext(ctx, query,
		record.ID, record.H3Index, record.Timestamp, record.Hour,
		record.DayOfWeek, record.IsHoliday, record.RideRequests,
		record.CompletedRides, record.AvailableDrivers, record.AvgWaitTimeMin,
		record.SurgeMultiplier, record.WeatherCondition, record.Temperature,
		record.PrecipitationMM, record.SpecialEventType, record.SpecialEventScale,
		record.CreatedAt,
	)
	return err
}

func (r *Repository) GetHistoricalDemand(ctx context.Context, h3Index string, startTime, endTime time.Time) ([]*HistoricalDemandRecord, error) {
	query := `
		SELECT id, h3_index, timestamp, hour, day_of_week, is_holiday,
			   ride_requests, completed_rides, available_drivers,
			   avg_wait_time_min, surge_multiplier, weather_condition,
			   temperature, precipitation_mm, special_event_type, special_event_scale,
			   created_at
		FROM historical_demand
		WHERE h3_index = $1 AND timestamp >= $2 AND timestamp <= $3
		ORDER BY timestamp DESC
	`

	rows, err := r.sqlDB().QueryContext(ctx, query, h3Index, startTime, endTime)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []*HistoricalDemandRecord
	for rows.Next() {
		record := &HistoricalDemandRecord{}
		err := rows.Scan(
			&record.ID, &record.H3Index, &record.Timestamp, &record.Hour,
			&record.DayOfWeek, &record.IsHoliday, &record.RideRequests,
			&record.CompletedRides, &record.AvailableDrivers, &record.AvgWaitTimeMin,
			&record.SurgeMultiplier, &record.WeatherCondition, &record.Temperature,
			&record.PrecipitationMM, &record.SpecialEventType, &record.SpecialEventScale,
			&record.CreatedAt,
		)
		if err != nil {
			return nil, err
		}
		records = append(records, record)
	}

	return records, nil
}

func (r *Repository) GetHistoricalAverage(ctx context.Context, h3Index string, hour, dayOfWeek int, weeksBack int) (float64, float64, error) {
	query := `
		SELECT
			COALESCE(AVG(ride_requests), 0) as avg_rides,
			COALESCE(STDDEV(ride_requests), 0) as std_rides
		FROM historical_demand
		WHERE h3_index = $1
		  AND hour = $2
		  AND day_of_week = $3
		  AND timestamp >= NOW() - ($4 || ' weeks')::interval
	`

	var avgRides, stdRides float64
	err := r.sqlDB().QueryRowContext(ctx, query, h3Index, hour, dayOfWeek, weeksBack).Scan(&avgRides, &stdRides)
	if err != nil {
		return 0, 0, err
	}

	return avgRides, stdRides, nil
}

func (r *Repository) GetRecentDemand(ctx context.Context, h3Index string, minutesBack int) (int, error) {
	query := `
		SELECT COALESCE(SUM(ride_requests), 0)
		FROM historical_demand
		WHERE h3_index = $1
		  AND timestamp >= NOW() - ($2 || ' minutes')::interval
	`

	var rides int
	err := r.sqlDB().QueryRowContext(ctx, query, h3Index, minutesBack).Scan(&rides)
	return rides, err
}

func (r *Repository) GetRecentDemandTrend(ctx context.Context, h3Index string) (float64, error) {
	query := `
		SELECT timestamp, ride_requests
		FROM historical_demand
		WHERE h3_index = $1
		  AND timestamp >= NOW() - INTERVAL '1 hour'
		ORDER BY timestamp ASC
		LIMIT 4
	`

	rows, err := r.sqlDB().QueryContext(ctx, query, h3Index)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	var timestamps []time.Time
	var demands []float64
	for rows.Next() {
		var ts time.Time
		var demand int
		if err := rows.Scan(&ts, &demand); err != nil {
			return 0, err
		}
		timestamps = append(timestamps, ts)
		demands = append(demands, float64(demand))
	}

	if len(demands) < 2 {
		return 0, nil
	}

	n := float64(len(demands))
	var sumX, sumY, sumXY, sumX2 float64
	for i := 0; i < len(demands); i++ {
		x := float64(i)
		y := demands[i]
		sumX += x
		sumY += y
		sumXY += x * y
		sumX2 += x * x
	}

	slope := (n*sumXY - sumX*sumY) / (n*sumX2 - sumX*sumX)
	return slope, nil
}

func (r *Repository) GetNeighborDemandAverage(ctx context.Context, neighborIndexes []string, minutesBack int) (float64, error) {
	if len(neighborIndexes) == 0 {
		return 0, nil
	}

	query := `
		SELECT COALESCE(AVG(ride_requests), 0)
		FROM historical_demand
		WHERE h3_index = ANY($1)
		  AND timestamp >= NOW() - ($2 || ' minutes')::interval
	`

	var avgDemand float64
	err := r.sqlDB().QueryRowContext(ctx, query, neighborIndexes, minutesBack).Scan(&avgDemand)
	return avgDemand, err
}

func (r *Repository) SavePrediction(ctx context.Context, pred *DemandPrediction) error {
	contributionsJSON, _ := json.Marshal(pred.FeatureContributions)

	query := `
		INSERT INTO demand_predictions (
			id, h3_index, prediction_time, generated_at, timeframe,
			predicted_rides, demand_level, confidence,
			recommended_drivers, expected_surge, hotspot_score,
			reposition_priority, feature_contributions
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
		)
		ON CONFLICT (h3_index, prediction_time, timeframe) DO UPDATE SET
			predicted_rides = EXCLUDED.predicted_rides,
			demand_level = EXCLUDED.demand_level,
			confidence = EXCLUDED.confidence,
			generated_at = EXCLUDED.generated_at,
			recommended_drivers = EXCLUDED.recommended_drivers,
			expected_surge = EXCLUDED.expected_surge,
			hotspot_score = EXCLUDED.hotspot_score,
			reposition_priority = EXCLUDED.reposition_priority,
			feature_contributions = EXCLUDED.feature_contributions
	`

	_, err := r.sqlDB().ExecContext(ctx, query,
		pred.ID, pred.H3Index, pred.PredictionTime, pred.GeneratedAt,
		pred.Timeframe, pred.PredictedRides, pred.DemandLevel,
		pred.Confidence, pred.RecommendedDrivers, pred.ExpectedSurge,
		pred.HotspotScore, pred.RepositionPriority, contributionsJSON,
	)
	return err
}

func (r *Repository) GetPrediction(ctx context.Context, h3Index string, predictionTime time.Time, timeframe PredictionTimeframe) (*DemandPrediction, error) {
	query := `
		SELECT id, h3_index, prediction_time, generated_at, timeframe,
			   predicted_rides, demand_level, confidence,
			   recommended_drivers, expected_surge, hotspot_score,
			   reposition_priority, feature_contributions
		FROM demand_predictions
		WHERE h3_index = $1
		  AND prediction_time = $2
		  AND timeframe = $3
	`

	pred := &DemandPrediction{}
	var contributionsJSON []byte
	err := r.sqlDB().QueryRowContext(ctx, query, h3Index, predictionTime, timeframe).Scan(
		&pred.ID, &pred.H3Index, &pred.PredictionTime, &pred.GeneratedAt,
		&pred.Timeframe, &pred.PredictedRides, &pred.DemandLevel,
		&pred.Confidence, &pred.RecommendedDrivers, &pred.ExpectedSurge,
		&pred.HotspotScore, &pred.RepositionPriority, &contributionsJSON,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	if len(contributionsJSON) > 0 {
		json.Unmarshal(contributionsJSON, &pred.FeatureContributions)
	}

	return pred, nil
}

func (r *Repository) GetLatestPrediction(ctx context.Context, h3Index string, timeframe PredictionTimeframe) (*DemandPrediction, error) {
	query := `
		SELECT id, h3_index, prediction_time, generated_at, timeframe,
			   predicted_rides, demand_level, confidence,
			   recommended_drivers, expected_surge, hotspot_score,
			   reposition_priority, feature_contributions
		FROM demand_predictions
		WHERE h3_index = $1
		  AND timeframe = $2
		  AND prediction_time > NOW()
		ORDER BY prediction_time ASC
		LIMIT 1
	`

	pred := &DemandPrediction{}
	var contributionsJSON []byte
	err := r.sqlDB().QueryRowContext(ctx, query, h3Index, timeframe).Scan(
		&pred.ID, &pred.H3Index, &pred.PredictionTime, &pred.GeneratedAt,
		&pred.Timeframe, &pred.PredictedRides, &pred.DemandLevel,
		&pred.Confidence, &pred.RecommendedDrivers, &pred.ExpectedSurge,
		&pred.HotspotScore, &pred.RepositionPriority, &contributionsJSON,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	if len(contributionsJSON) > 0 {
		json.Unmarshal(contributionsJSON, &pred.FeatureContributions)
	}

	return pred, nil
}

func (r *Repository) GetPredictionsInBoundingBox(ctx context.Context, timeframe PredictionTimeframe, minDemandLevel *DemandLevel) ([]*DemandPrediction, error) {
	query := `
		SELECT id, h3_index, prediction_time, generated_at, timeframe,
			   predicted_rides, demand_level, confidence,
			   recommended_drivers, expected_surge, hotspot_score,
			   reposition_priority, feature_contributions
		FROM demand_predictions
		WHERE timeframe = $1
		  AND prediction_time > NOW()
		  AND prediction_time <= NOW() + INTERVAL '4 hours'
		  AND ($2::text IS NULL OR demand_level >= $2)
		ORDER BY hotspot_score DESC
		LIMIT 100
	`

	var minLevel *string
	if minDemandLevel != nil {
		l := string(*minDemandLevel)
		minLevel = &l
	}

	rows, err := r.sqlDB().QueryContext(ctx, query, timeframe, minLevel)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var predictions []*DemandPrediction
	for rows.Next() {
		pred := &DemandPrediction{}
		var contributionsJSON []byte
		err := rows.Scan(
			&pred.ID, &pred.H3Index, &pred.PredictionTime, &pred.GeneratedAt,
			&pred.Timeframe, &pred.PredictedRides, &pred.DemandLevel,
			&pred.Confidence, &pred.RecommendedDrivers, &pred.ExpectedSurge,
			&pred.HotspotScore, &pred.RepositionPriority, &contributionsJSON,
		)
		if err != nil {
			return nil, err
		}
		if len(contributionsJSON) > 0 {
			json.Unmarshal(contributionsJSON, &pred.FeatureContributions)
		}
		predictions = append(predictions, pred)
	}

	return predictions, nil
}

func (r *Repository) GetTopHotspots(ctx context.Context, timeframe PredictionTimeframe, limit int) ([]*DemandPrediction, error) {
	query := `
		SELECT id, h3_index, prediction_time, generated_at, timeframe,
			   predicted_rides, demand_level, confidence,
			   recommended_drivers, expected_surge, hotspot_score,
			   reposition_priority, feature_contributions
		FROM demand_predictions
		WHERE timeframe = $1
		  AND prediction_time > NOW()
		  AND prediction_time <= NOW() + INTERVAL '1 hour'
		ORDER BY hotspot_score DESC
		LIMIT $2
	`

	rows, err := r.sqlDB().QueryContext(ctx, query, timeframe, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var predictions []*DemandPrediction
	for rows.Next() {
		pred := &DemandPrediction{}
		var contributionsJSON []byte
		err := rows.Scan(
			&pred.ID, &pred.H3Index, &pred.PredictionTime, &pred.GeneratedAt,
			&pred.Timeframe, &pred.PredictedRides, &pred.DemandLevel,
			&pred.Confidence, &pred.RecommendedDrivers, &pred.ExpectedSurge,
			&pred.HotspotScore, &pred.RepositionPriority, &contributionsJSON,
		)
		if err != nil {
			return nil, err
		}
		if len(contributionsJSON) > 0 {
			json.Unmarshal(contributionsJSON, &pred.FeatureContributions)
		}
		predictions = append(predictions, pred)
	}

	return predictions, nil
}

func (r *Repository) CreateEvent(ctx context.Context, event *SpecialEvent) error {
	query := `
		INSERT INTO special_events (
			id, name, event_type, latitude, longitude, h3_index,
			start_time, end_time, expected_attendees, impact_radius,
			demand_multiplier, is_recurring, created_at, updated_at
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
		)
	`

	_, err := r.sqlDB().ExecContext(ctx, query,
		event.ID, event.Name, event.EventType, event.Latitude, event.Longitude,
		event.H3Index, event.StartTime, event.EndTime, event.ExpectedAttendees,
		event.ImpactRadius, event.DemandMultiplier, event.IsRecurring,
		event.CreatedAt, event.UpdatedAt,
	)
	return err
}

func (r *Repository) GetUpcomingEvents(ctx context.Context, startTime, endTime time.Time) ([]*SpecialEvent, error) {
	query := `
		SELECT id, name, event_type, latitude, longitude, h3_index,
			   start_time, end_time, expected_attendees, impact_radius,
			   demand_multiplier, is_recurring, created_at, updated_at
		FROM special_events
		WHERE start_time <= $2 AND end_time >= $1
		ORDER BY start_time ASC
	`

	rows, err := r.sqlDB().QueryContext(ctx, query, startTime, endTime)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []*SpecialEvent
	for rows.Next() {
		event := &SpecialEvent{}
		err := rows.Scan(
			&event.ID, &event.Name, &event.EventType, &event.Latitude,
			&event.Longitude, &event.H3Index, &event.StartTime, &event.EndTime,
			&event.ExpectedAttendees, &event.ImpactRadius, &event.DemandMultiplier,
			&event.IsRecurring, &event.CreatedAt, &event.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		events = append(events, event)
	}

	return events, nil
}

func (r *Repository) GetEventsNearLocation(ctx context.Context, latitude, longitude float64, radiusKm float64, timeWindow time.Duration) ([]*SpecialEvent, error) {
	query := `
		SELECT id, name, event_type, latitude, longitude, h3_index,
			   start_time, end_time, expected_attendees, impact_radius,
			   demand_multiplier, is_recurring, created_at, updated_at
		FROM special_events
		WHERE ST_DWithin(
			ST_MakePoint(longitude, latitude)::geography,
			ST_MakePoint($1, $2)::geography,
			$3 * 1000
		)
		AND start_time <= NOW() + $4::interval
		AND end_time >= NOW()
		ORDER BY start_time ASC
	`

	rows, err := r.sqlDB().QueryContext(ctx, query, longitude, latitude, radiusKm, timeWindow.String())
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []*SpecialEvent
	for rows.Next() {
		event := &SpecialEvent{}
		err := rows.Scan(
			&event.ID, &event.Name, &event.EventType, &event.Latitude,
			&event.Longitude, &event.H3Index, &event.StartTime, &event.EndTime,
			&event.ExpectedAttendees, &event.ImpactRadius, &event.DemandMultiplier,
			&event.IsRecurring, &event.CreatedAt, &event.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		events = append(events, event)
	}

	return events, nil
}

func (r *Repository) RecordPredictionAccuracy(ctx context.Context, predictionID uuid.UUID, actualRides int) error {
	query := `
		UPDATE demand_predictions
		SET actual_rides = $2,
			accuracy_error = ABS(predicted_rides - $2)
		WHERE id = $1
	`
	_, err := r.sqlDB().ExecContext(ctx, query, predictionID, actualRides)
	return err
}

func (r *Repository) GetAccuracyMetrics(ctx context.Context, timeframe PredictionTimeframe, daysBack int) (*ForecastAccuracyMetrics, error) {
	query := `
		SELECT
			COUNT(*) as samples,
			AVG(ABS(predicted_rides - COALESCE(actual_rides, 0))) as mae,
			SQRT(AVG(POWER(predicted_rides - COALESCE(actual_rides, 0), 2))) as rmse,
			AVG(CASE
				WHEN COALESCE(actual_rides, 1) > 0
				THEN ABS(predicted_rides - COALESCE(actual_rides, 0)) / COALESCE(actual_rides, 1) * 100
				ELSE 0
			END) as mape
		FROM demand_predictions
		WHERE timeframe = $1
		  AND prediction_time < NOW()
		  AND prediction_time >= NOW() - ($2 || ' days')::interval
		  AND actual_rides IS NOT NULL
	`

	metrics := &ForecastAccuracyMetrics{
		Timeframe:        timeframe,
		EvaluationPeriod: "last_" + string(rune(daysBack)) + "_days",
		UpdatedAt:        time.Now(),
	}

	err := r.sqlDB().QueryRowContext(ctx, query, timeframe, daysBack).Scan(
		&metrics.SamplesEvaluated, &metrics.MAE, &metrics.RMSE, &metrics.MAPE,
	)
	if err != nil {
		return nil, err
	}

	return metrics, nil
}

func (r *Repository) CleanupOldPredictions(ctx context.Context, daysOld int) (int64, error) {
	query := `
		DELETE FROM demand_predictions
		WHERE prediction_time < NOW() - ($1 || ' days')::interval
	`

	result, err := r.sqlDB().ExecContext(ctx, query, daysOld)
	if err != nil {
		return 0, err
	}

	n, err2 := result.RowsAffected()
	return n, err2
}

func (r *Repository) sqlDB() *sql.DB {
	sqlDB, _ := r.db.DB()
	return sqlDB
}
