package models

import "github.com/google/uuid"

type RideMetrics struct {
	AvgWaitTimeMinutes     float64 `json:"avg_wait_time_minutes"`
	AvgRideDurationMinutes float64 `json:"avg_ride_duration_minutes"`
	AvgDistanceKm          float64 `json:"avg_distance_km"`
	CancellationRate       float64 `json:"cancellation_rate"`
	RiderCancellationRate  float64 `json:"rider_cancellation_rate"`
	DriverCancellationRate float64 `json:"driver_cancellation_rate"`
	SurgeRidesPercentage   float64 `json:"surge_rides_percentage"`
	AvgSurgeMultiplier     float64 `json:"avg_surge_multiplier"`
}

type RideTypeStats struct {
	RideTypeID   uuid.UUID `json:"ride_type_id"`
	Name         string    `json:"name"`
	TotalRides   int       `json:"total_rides"`
	TotalRevenue float64   `json:"total_revenue"`
	AvgFare      float64   `json:"avg_fare"`
	Percentage   float64   `json:"percentage"`
}

type HourlyDistribution struct {
	Hour        int     `json:"hour"`
	Rides       int     `json:"rides"`
	AvgFare     float64 `json:"avg_fare"`
	AvgWaitTime float64 `json:"avg_wait_time_minutes"`
}
