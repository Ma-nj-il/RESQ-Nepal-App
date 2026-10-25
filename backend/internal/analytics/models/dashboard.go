package models

type DashboardMetrics struct {
	TotalRides     int            `json:"total_rides"`
	ActiveRides    int            `json:"active_rides"`
	CompletedToday int            `json:"completed_today"`
	RevenueToday   float64        `json:"revenue_today"`
	ActiveDrivers  int            `json:"active_drivers"`
	ActiveRiders   int            `json:"active_riders"`
	AvgRating      float64        `json:"avg_rating"`
	TopRideType    *RideTypeStats `json:"top_ride_type,omitempty"`
}

type DemandHeatMap struct {
	Latitude    float64 `json:"latitude"`
	Longitude   float64 `json:"longitude"`
	RideCount   int     `json:"ride_count"`
	AvgWaitTime int     `json:"avg_wait_time_minutes"`
	AvgFare     float64 `json:"avg_fare"`
	DemandLevel string  `json:"demand_level"`
	SurgeActive bool    `json:"surge_active"`
}

type DemandZone struct {
	ZoneName        string  `json:"zone_name"`
	CenterLatitude  float64 `json:"center_latitude"`
	CenterLongitude float64 `json:"center_longitude"`
	RadiusKm        float64 `json:"radius_km"`
	TotalRides      int     `json:"total_rides"`
	AvgSurge        float64 `json:"avg_surge_multiplier"`
	PeakHours       string  `json:"peak_hours"`
}
