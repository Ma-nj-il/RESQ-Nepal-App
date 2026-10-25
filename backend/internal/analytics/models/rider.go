package models

type RiderGrowth struct {
	NewRiders            int     `json:"new_riders"`
	ReturningRiders      int     `json:"returning_riders"`
	ChurnedRiders        int     `json:"churned_riders"`
	RetentionRate        float64 `json:"retention_rate"`
	AvgRidesPerRider     float64 `json:"avg_rides_per_rider"`
	FirstTimeRidersToday int     `json:"first_time_riders_today"`
	LifetimeValueAvg     float64 `json:"lifetime_value_avg"`
}
