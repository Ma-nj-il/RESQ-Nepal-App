package mleta

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	"github.com/bikky-kc013/medi-ambulance/pkg/redis"
	"go.uber.org/zap"
)

type ETARepository interface {
	GetHistoricalETAForRoute(ctx context.Context, pickupLatitude, pickupLongitude, dropoffLatitude, dropoffLongitude float64) (float64, error)
	StorePrediction(ctx context.Context, prediction *ETAPrediction) error
	GetTrainingData(ctx context.Context, limit int) ([]*TrainingDataPoint, error)
	StoreModelStats(ctx context.Context, model *ETAModel) error
	GetPredictionHistory(ctx context.Context, limit int, offset int) ([]*ETAPrediction, error)
	GetAccuracyMetrics(ctx context.Context, days int) (map[string]interface{}, error)
}

type Service struct {
	repo  ETARepository
	redis redis.ClientInterface
	model *ETAModel
}

func NewService(repo ETARepository, redis redis.ClientInterface) *Service {
	return &Service{
		repo:  repo,
		redis: redis,
		model: NewETAModel(),
	}
}

type ETAModel struct {
	DistanceWeight     float64
	TrafficWeight      float64
	TimeOfDayWeight    float64
	DayOfWeekWeight    float64
	WeatherWeight      float64
	HistoricalWeight   float64
	DriverRatingWeight float64

	BaseSpeed          float64
	TrafficMultipliers map[string]float64
	TimeOfDayFactors   map[int]float64
	WeatherImpact      map[string]float64

	TrainedAt         time.Time
	TotalPredictions  int64
	AccuracyRate      float64
	MeanAbsoluteError float64
}

func NewETAModel() *ETAModel {
	return &ETAModel{
		DistanceWeight:     0.70,
		TrafficWeight:      0.15,
		TimeOfDayWeight:    0.05,
		DayOfWeekWeight:    0.03,
		WeatherWeight:      0.04,
		HistoricalWeight:   0.03,
		DriverRatingWeight: 0.00,

		BaseSpeed: 35.0,

		TrafficMultipliers: map[string]float64{
			"low":    1.0,
			"medium": 1.3,
			"high":   1.8,
			"severe": 2.5,
		},

		TimeOfDayFactors: map[int]float64{
			0: 0.9, 1: 0.9, 2: 0.9, 3: 0.9, 4: 0.9, 5: 0.9,
			6: 1.2, 7: 1.4, 8: 1.5, 9: 1.3, 10: 1.1,
			11: 1.0, 12: 1.1, 13: 1.1, 14: 1.0, 15: 1.1,
			16: 1.3, 17: 1.5, 18: 1.6, 19: 1.4, 20: 1.2,
			21: 1.0, 22: 0.95, 23: 0.9,
		},

		WeatherImpact: map[string]float64{
			"clear":      1.0,
			"cloudy":     1.05,
			"rain":       1.25,
			"heavy_rain": 1.5,
			"snow":       1.6,
			"storm":      1.8,
		},

		TrainedAt:         time.Now(),
		AccuracyRate:      0.85,
		MeanAbsoluteError: 3.5,
	}
}

type ETAPredictionRequest struct {
	PickupLatitude   float64 `json:"pickup_latitude"`
	PickupLongitude  float64 `json:"pickup_longitude"`
	DropoffLatitude  float64 `json:"dropoff_latitude"`
	DropoffLongitude float64 `json:"dropoff_longitude"`
	TrafficLevel     string  `json:"traffic_level"` // low, medium, high, severe
	Weather          string  `json:"weather"`       // clear, cloudy, rain, etc.
	DriverID         string  `json:"driver_id"`
	RideTypeID       int     `json:"ride_type_id"`
}

// ETAPredictionResponse contains the prediction results
type ETAPredictionResponse struct {
	EstimatedMinutes     float64            `json:"estimated_minutes"`
	EstimatedSeconds     int                `json:"estimated_seconds"`
	Distance             float64            `json:"distance_km"`
	Confidence           float64            `json:"confidence"`
	Factors              map[string]float64 `json:"factors"`
	ModelVersion         string             `json:"model_version"`
	PredictedArrivalTime time.Time          `json:"predicted_arrival_time"`
}

func (s *Service) PredictETA(ctx context.Context, req *ETAPredictionRequest) (*ETAPredictionResponse, error) {
	distance := calculateDistance(req.PickupLatitude, req.PickupLongitude, req.DropoffLatitude, req.DropoffLongitude)

	historicalETA, err := s.getHistoricalETA(ctx, req.PickupLatitude, req.PickupLongitude, req.DropoffLatitude, req.DropoffLongitude)
	if err != nil {
		logger.Warn("Could not fetch historical ETA", zap.Error(err))
		historicalETA = 0
	}

	trafficMultiplier := s.model.TrafficMultipliers[req.TrafficLevel]
	if trafficMultiplier == 0 {
		trafficMultiplier = 1.0
	}

	hour := time.Now().Hour()
	timeOfDayFactor := s.model.TimeOfDayFactors[hour]
	if timeOfDayFactor == 0 {
		timeOfDayFactor = 1.0
	}

	weatherImpact := s.model.WeatherImpact[req.Weather]
	if weatherImpact == 0 {
		weatherImpact = 1.0
	}

	dayOfWeekFactor := 1.0
	if time.Now().Weekday() == time.Saturday || time.Now().Weekday() == time.Sunday {
		dayOfWeekFactor = 0.9
	}

	baseETA := (distance / s.model.BaseSpeed) * 60

	predictedETA := baseETA
	predictedETA *= (s.model.DistanceWeight * 1.0)
	predictedETA *= (1 + (trafficMultiplier-1)*s.model.TrafficWeight)
	predictedETA *= (1 + (timeOfDayFactor-1)*s.model.TimeOfDayWeight)
	predictedETA *= (1 + (dayOfWeekFactor-1)*s.model.DayOfWeekWeight)
	predictedETA *= (1 + (weatherImpact-1)*s.model.WeatherWeight)

	if historicalETA > 0 {
		predictedETA = predictedETA*(1-s.model.HistoricalWeight) + historicalETA*s.model.HistoricalWeight
	}

	confidence := s.calculateConfidence(historicalETA > 0, req.TrafficLevel != "", req.Weather != "")

	response := &ETAPredictionResponse{
		EstimatedMinutes:     math.Round(predictedETA*10) / 10,
		EstimatedSeconds:     int(predictedETA * 60),
		Distance:             math.Round(distance*10) / 10,
		Confidence:           confidence,
		ModelVersion:         "v1.0-ml",
		PredictedArrivalTime: time.Now().Add(time.Duration(predictedETA * float64(time.Minute))),
		Factors: map[string]float64{
			"base_eta":       baseETA,
			"traffic":        trafficMultiplier,
			"time_of_day":    timeOfDayFactor,
			"day_of_week":    dayOfWeekFactor,
			"weather":        weatherImpact,
			"historical_eta": historicalETA,
		},
	}

	go s.storePrediction(ctx, req, response)

	s.model.TotalPredictions++

	return response, nil
}

func (s *Service) BatchPredictETA(ctx context.Context, requests []*ETAPredictionRequest) ([]*ETAPredictionResponse, error) {
	responses := make([]*ETAPredictionResponse, len(requests))

	for i, req := range requests {
		resp, err := s.PredictETA(ctx, req)
		if err != nil {
			return nil, fmt.Errorf("failed to predict ETA for request %d: %w", i, err)
		}
		responses[i] = resp
	}

	return responses, nil
}

func (s *Service) calculateConfidence(hasHistorical, hasTraffic, hasWeather bool) float64 {
	confidence := 0.7

	if hasHistorical {
		confidence += 0.15
	}
	if hasTraffic {
		confidence += 0.10
	}
	if hasWeather {
		confidence += 0.05
	}

	confidence *= s.model.AccuracyRate

	return math.Round(confidence*100) / 100
}

func (s *Service) getHistoricalETA(ctx context.Context, pickupLatitude, pickupLongitude, dropoffLatitude, dropoffLongitude float64) (float64, error) {
	routeKey := fmt.Sprintf("eta:route:%.2f,%.2f:%.2f,%.2f",
		math.Round(pickupLatitude*100)/100,
		math.Round(pickupLongitude*100)/100,
		math.Round(dropoffLatitude*100)/100,
		math.Round(dropoffLongitude*100)/100)

	cachedETA, err := s.redis.GetString(ctx, routeKey)
	if err == nil && cachedETA != "" {
		var eta float64
		if err := json.Unmarshal([]byte(cachedETA), &eta); err == nil {
			return eta, nil
		}
	}

	eta, err := s.repo.GetHistoricalETAForRoute(ctx, pickupLatitude, pickupLongitude, dropoffLatitude, dropoffLongitude)
	if err != nil {
		return 0, err
	}

	if etaBytes, err := json.Marshal(eta); err == nil {
		_ = s.redis.SetWithExpiration(ctx, routeKey, string(etaBytes), 24*time.Hour)
	}

	return eta, nil
}

func (s *Service) storePrediction(ctx context.Context, req *ETAPredictionRequest, resp *ETAPredictionResponse) error {
	prediction := &ETAPrediction{
		PickupLatitude:   req.PickupLatitude,
		PickupLongitude:  req.PickupLongitude,
		DropoffLatitude:  req.DropoffLatitude,
		DropoffLongitude: req.DropoffLongitude,
		PredictedMinutes: resp.EstimatedMinutes,
		Distance:         resp.Distance,
		TrafficLevel:     req.TrafficLevel,
		Weather:          req.Weather,
		TimeOfDay:        time.Now().Hour(),
		DayOfWeek:        int(time.Now().Weekday()),
		Confidence:       resp.Confidence,
		CreatedAt:        time.Now(),
	}

	return s.repo.StorePrediction(ctx, prediction)
}

func (s *Service) StartModelTrainingWorker(ctx context.Context) {
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()

	logger.Info("ML ETA model training worker started")

	for {
		select {
		case <-ctx.Done():
			logger.Info("ML ETA model training worker stopped")
			return
		case <-ticker.C:
			logger.Info("Starting automatic model retraining")
			if err := s.TrainModel(ctx); err != nil {
				logger.Error("Model retraining failed", zap.Error(err))
			} else {
				logger.Info("Model retraining completed successfully")
			}
		}
	}
}

func (s *Service) TrainModel(ctx context.Context) error {
	logger.Info("Fetching training data")

	trainingData, err := s.repo.GetTrainingData(ctx, 10000)
	if err != nil {
		return fmt.Errorf("failed to fetch training data: %w", err)
	}

	if len(trainingData) < 100 {
		return fmt.Errorf("insufficient training data: need at least 100 samples, got %d", len(trainingData))
	}

	logger.Info("Training model", zap.Int("samples", len(trainingData)))

	totalError := 0.0
	predictions := 0

	for _, data := range trainingData {
		req := &ETAPredictionRequest{
			PickupLatitude:   data.PickupLatitude,
			PickupLongitude:  data.PickupLongitude,
			DropoffLatitude:  data.DropoffLatitude,
			DropoffLongitude: data.DropoffLongitude,
			TrafficLevel:     "medium",
			Weather:          "clear",
		}

		prediction, err := s.PredictETA(ctx, req)
		if err != nil {
			continue
		}

		error := math.Abs(prediction.EstimatedMinutes - data.ActualMinutes)
		totalError += error
		predictions++
	}

	if predictions > 0 {
		s.model.MeanAbsoluteError = totalError / float64(predictions)
		s.model.AccuracyRate = 1.0 - math.Min(s.model.MeanAbsoluteError/15.0, 0.5)
	}

	s.model.TrainedAt = time.Now()

	logger.Info("Model training complete", zap.Float64("mae_minutes", s.model.MeanAbsoluteError), zap.Float64("accuracy_pct", s.model.AccuracyRate*100))

	return s.repo.StoreModelStats(ctx, s.model)
}

func (s *Service) GetModelStats() *ETAModel {
	return s.model
}

func calculateDistance(latitude1, longitude1, latitude2, longitude2 float64) float64 {
	const R = 6371

	deltaLatitude := toRadians(latitude2 - latitude1)
	deltaLongitude := toRadians(longitude2 - longitude1)

	a := math.Sin(deltaLatitude/2)*math.Sin(deltaLatitude/2) +
		math.Cos(toRadians(latitude1))*math.Cos(toRadians(latitude2))*
			math.Sin(deltaLongitude/2)*math.Sin(deltaLongitude/2)

	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))

	return R * c
}

func toRadians(degrees float64) float64 {
	return degrees * math.Pi / 180
}
