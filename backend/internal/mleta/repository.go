package mleta

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/database"
	"github.com/bikky-kc013/medi-ambulance/pkg/redis"
)

type Repository struct {
	db    *database.DBPool
	redis *redis.Client
}

var _ ETARepository = (*Repository)(nil)

func NewRepository(db *database.DBPool, redis *redis.Client) *Repository {
	return &Repository{db: db, redis: redis}
}

type ETAPrediction struct {
	ID               int       `json:"id" gorm:"primaryKey"`
	PickupLatitude   float64   `json:"pickup_latitude"`
	PickupLongitude  float64   `json:"pickup_longitude"`
	DropoffLatitude  float64   `json:"dropoff_latitude"`
	DropoffLongitude float64   `json:"dropoff_longitude"`
	PredictedMinutes float64   `json:"predicted_minutes"`
	ActualMinutes    *float64  `json:"actual_minutes,omitempty"`
	Distance         float64   `json:"distance"`
	TrafficLevel     string    `json:"traffic_level"`
	Weather          string    `json:"weather"`
	TimeOfDay        int       `json:"time_of_day"`
	DayOfWeek        int       `json:"day_of_week"`
	Confidence       float64   `json:"confidence"`
	RideID           *string   `json:"ride_id,omitempty"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at,omitempty"`
}

func (ETAPrediction) TableName() string {
	return "eta_predictions"
}

type TrainingDataPoint struct {
	PickupLatitude   float64 `json:"pickup_latitude"`
	PickupLongitude  float64 `json:"pickup_longitude"`
	DropoffLatitude  float64 `json:"dropoff_latitude"`
	DropoffLongitude float64 `json:"dropoff_longitude"`
	ActualMinutes    float64 `json:"actual_minutes"`
	Distance         float64 `json:"distance"`
	TrafficLevel     string  `json:"traffic_level"`
	Weather          string  `json:"weather"`
	TimeOfDay        int     `json:"time_of_day"`
	DayOfWeek        int     `json:"day_of_day"`
}

func (r *Repository) StorePrediction(ctx context.Context, prediction *ETAPrediction) error {
	prediction.CreatedAt = time.Now()
	err := r.db.Primary.WithContext(ctx).Create(prediction).Error
	return err
}

func (r *Repository) UpdatePredictionWithActual(ctx context.Context, rideID string, actualMinutes float64) error {
	var prediction ETAPrediction
	err := r.db.Primary.WithContext(ctx).
		Where("ride_id IS NULL").
		Order("created_at DESC").
		First(&prediction).Error
	if err != nil {
		return err
	}

	return r.db.Primary.WithContext(ctx).Model(&prediction).Updates(map[string]interface{}{
		"actual_minutes": actualMinutes,
		"ride_id":        rideID,
		"updated_at":     time.Now(),
	}).Error
}

func (r *Repository) GetHistoricalETAForRoute(ctx context.Context, pickupLatitude, pickupLongitude, dropoffLatitude, dropoffLongitude float64) (float64, error) {
	var avgETA float64
	err := r.db.Primary.WithContext(ctx).Table("eta_predictions").
		Select("COALESCE(AVG(actual_minutes), 0)").
		Where("actual_minutes IS NOT NULL AND actual_minutes > 0").
		Where("ABS(pickup_latitude - ?) < 0.005", pickupLatitude).
		Where("ABS(pickup_longitude - ?) < 0.005", pickupLongitude).
		Where("ABS(dropoff_latitude - ?) < 0.005", dropoffLatitude).
		Where("ABS(dropoff_longitude - ?) < 0.005", dropoffLongitude).
		Where("created_at > NOW() - INTERVAL '90 days'").
		Group("DATE_TRUNC('hour', created_at)").
		Order("DATE_TRUNC('hour', created_at) DESC").
		Limit(10).
		Scan(&avgETA).Error

	if err != nil {
		return 0, err
	}

	return avgETA, nil
}

func (r *Repository) GetTrainingData(ctx context.Context, limit int) ([]*TrainingDataPoint, error) {
	var dataPoints []*TrainingDataPoint
	err := r.db.Primary.WithContext(ctx).Table("eta_predictions").
		Select(`
			pickup_latitude, pickup_longitude, dropoff_latitude, dropoff_longitude,
			actual_minutes, distance,
			COALESCE(traffic_level, 'medium') as traffic_level,
			COALESCE(weather, 'clear') as weather,
			time_of_day, day_of_week
		`).
		Where("actual_minutes IS NOT NULL AND actual_minutes > 0 AND actual_minutes < 180 AND distance > 0").
		Order("created_at DESC").
		Limit(limit).
		Scan(&dataPoints).Error

	return dataPoints, err
}

func (r *Repository) StoreModelStats(ctx context.Context, model *ETAModel) error {
	configJSON, err := json.Marshal(model)
	if err != nil {
		return fmt.Errorf("failed to marshal model config: %w", err)
	}

	err = r.db.Primary.WithContext(ctx).Table("eta_model_stats").Create(map[string]interface{}{
		"trained_at":          model.TrainedAt,
		"total_predictions":   model.TotalPredictions,
		"accuracy_rate":       model.AccuracyRate,
		"mean_absolute_error": model.MeanAbsoluteError,
		"model_config":        configJSON,
	}).Error

	if err != nil {
		return err
	}

	cacheKey := "eta:model:latest"
	return r.redis.SetWithExpiration(ctx, cacheKey, string(configJSON), 24*time.Hour)
}

func (r *Repository) GetModelStats(ctx context.Context) (*ETAModel, error) {
	cacheKey := "eta:model:latest"
	cached, err := r.redis.GetString(ctx, cacheKey)
	if err == nil && cached != "" {
		var model ETAModel
		if err := json.Unmarshal([]byte(cached), &model); err == nil {
			return &model, nil
		}
	}

	var result struct {
		ModelConfig       []byte
		TrainedAt         time.Time
		TotalPredictions  int64
		AccuracyRate      float64
		MeanAbsoluteError float64
	}

	err = r.db.Primary.WithContext(ctx).Table("eta_model_stats").
		Select("model_config, trained_at, total_predictions, accuracy_rate, mean_absolute_error").
		Order("trained_at DESC").
		Limit(1).
		Scan(&result).Error

	if err != nil {
		return nil, err
	}

	var model ETAModel
	if err := json.Unmarshal(result.ModelConfig, &model); err != nil {
		return nil, fmt.Errorf("failed to unmarshal model config: %w", err)
	}
	model.TrainedAt = result.TrainedAt
	model.TotalPredictions = result.TotalPredictions
	model.AccuracyRate = result.AccuracyRate
	model.MeanAbsoluteError = result.MeanAbsoluteError

	return &model, nil
}

func (r *Repository) GetPredictionHistory(ctx context.Context, limit int, offset int) ([]*ETAPrediction, error) {
	var predictions []*ETAPrediction
	err := r.db.Primary.WithContext(ctx).
		Order("created_at DESC").
		Limit(limit).
		Offset(offset).
		Find(&predictions).Error

	return predictions, err
}

func (r *Repository) GetAccuracyMetrics(ctx context.Context, days int) (map[string]interface{}, error) {
	var metrics []struct {
		Date               string  `json:"date"`
		TotalPredictions   int     `json:"total_predictions"`
		CompletedRides     int     `json:"completed_rides"`
		MeanAbsoluteError  float64 `json:"mean_absolute_error"`
		AccuracyPercentage float64 `json:"accuracy_percentage"`
	}

	err := r.db.Primary.WithContext(ctx).Table("eta_predictions").
		Select(`
			DATE(created_at) as date,
			COUNT(*) as total_predictions,
			COUNT(CASE WHEN actual_minutes IS NOT NULL THEN 1 END) as completed_rides,
			AVG(CASE
				WHEN actual_minutes IS NOT NULL
				THEN ABS(predicted_minutes - actual_minutes)
			END) as mean_absolute_error,
			AVG(CASE
				WHEN actual_minutes IS NOT NULL
				THEN (1 - LEAST(ABS(predicted_minutes - actual_minutes) / NULLIF(actual_minutes, 0), 1)) * 100
			END) as accuracy_percentage
		`).
		Where("created_at > NOW() - (? * INTERVAL '1 day')", days).
		Group("DATE(created_at)").
		Order("date DESC").
		Scan(&metrics).Error

	if err != nil {
		return nil, err
	}

	return map[string]interface{}{
		"daily_metrics": metrics,
		"period_days":   days,
	}, nil
}
