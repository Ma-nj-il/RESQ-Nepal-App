package models

import "github.com/google/uuid"

type DriverPerformance struct {
	DriverID         uuid.UUID `json:"driver_id"`
	DriverName       string    `json:"driver_name"`
	TotalRides       int       `json:"total_rides"`
	TotalEarnings    float64   `json:"total_earnings"`
	AvgRating        float64   `json:"avg_rating"`
	CompletionRate   float64   `json:"completion_rate"`
	CancellationRate float64   `json:"cancellation_rate"`
}

type DriverAnalytics struct {
	TotalActiveDrivers  int     `json:"total_active_drivers"`
	AvgRidesPerDriver   float64 `json:"avg_rides_per_driver"`
	AvgOnlineHours      float64 `json:"avg_online_hours"`
	AvgAcceptanceRate   float64 `json:"avg_acceptance_rate"`
	AvgCancellationRate float64 `json:"avg_cancellation_rate"`
	AvgRating           float64 `json:"avg_rating"`
	NewDrivers          int     `json:"new_drivers"`
	ChurnedDrivers      int     `json:"churned_drivers"`
}

type TopDriver struct {
	DriverID       uuid.UUID `json:"driver_id"`
	Name           string    `json:"name"`
	TotalRides     int       `json:"total_rides"`
	TotalRevenue   float64   `json:"total_revenue"`
	AvgRating      float64   `json:"avg_rating"`
	AcceptanceRate float64   `json:"acceptance_rate"`
	OnlineHours    float64   `json:"online_hours"`
}
