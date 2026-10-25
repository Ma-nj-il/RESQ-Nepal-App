package models

import "time"

type DateRange struct {
	StartDate time.Time `json:"start_date"`
	EndDate   time.Time `json:"end_date"`
}

type ComparisonMetric struct {
	Current       float64 `json:"current"`
	Previous      float64 `json:"previous"`
	ChangePercent float64 `json:"change_percent"`
}

type PeriodComparison struct {
	Revenue   ComparisonMetric `json:"revenue"`
	Rides     ComparisonMetric `json:"rides"`
	NewRiders ComparisonMetric `json:"new_riders"`
	AvgRating ComparisonMetric `json:"avg_rating"`
}
