package models

type RevenueMetrics struct {
	Period           string  `json:"period"`
	TotalRevenue     float64 `json:"total_revenue"`
	TotalRides       int     `json:"total_rides"`
	AvgFarePerRide   float64 `json:"avg_fare_per_ride"`
	TotalDiscounts   float64 `json:"total_discounts"`
	PlatformEarnings float64 `json:"platform_earnings"`
	DriverEarnings   float64 `json:"driver_earnings"`
}

type FinancialReport struct {
	Period              string  `json:"period"`
	GrossRevenue        float64 `json:"gross_revenue"`
	NetRevenue          float64 `json:"net_revenue"`
	PlatformCommission  float64 `json:"platform_commission"`
	DriverPayouts       float64 `json:"driver_payouts"`
	ReferralBonuses     float64 `json:"referral_bonuses"`
	Refunds             float64 `json:"refunds"`
	TotalExpenses       float64 `json:"total_expenses"`
	Profit              float64 `json:"profit"`
	ProfitMargin        float64 `json:"profit_margin_percent"`
	TotalRides          int     `json:"total_rides"`
	CompletedRides      int     `json:"completed_rides"`
	CancelledRides      int     `json:"cancelled_rides"`
	AvgRevenuePerRide   float64 `json:"avg_revenue_per_ride"`
	TopRevenueDay       string  `json:"top_revenue_day,omitempty"`
	TopRevenueDayAmount float64 `json:"top_revenue_day_amount"`
}

type RevenueTimeSeries struct {
	Date    string  `json:"date"`
	Revenue float64 `json:"revenue"`
	Rides   int     `json:"rides"`
	AvgFare float64 `json:"avg_fare"`
}
