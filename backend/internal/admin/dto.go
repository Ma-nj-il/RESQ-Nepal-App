package admin

import (
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/models"
	"github.com/google/uuid"
)

type AuditLogFilter struct {
	AdminID    *uuid.UUID
	Action     string
	TargetType string
	TargetID   *uuid.UUID
}

type UserFilter struct {
	Role     string
	IsActive *bool
	Search   string
}

type DriverFilter struct {
	Status string
	Search string
}

type DriverStats struct {
	TotalDrivers     int `json:"total_drivers"`
	OnlineDrivers    int `json:"online_drivers"`
	OfflineDrivers   int `json:"offline_drivers"`
	AvailableDrivers int `json:"available_drivers"`
	PendingApprovals int `json:"pending_approvals"`
}

type RideStats struct {
	TotalRides     int     `json:"total_rides"`
	CompletedRides int     `json:"completed_rides"`
	CancelledRides int     `json:"cancelled_rides"`
	ActiveRides    int     `json:"active_rides"`
	TotalRevenue   float64 `json:"total_revenue"`
	AvgFare        float64 `json:"avg_fare"`
}

type UserStats struct {
	TotalUsers   int `json:"total_users"`
	TotalRiders  int `json:"total_riders"`
	TotalDrivers int `json:"total_drivers"`
	TotalAdmins  int `json:"total_admins"`
	ActiveUsers  int `json:"active_users"`
}

type AdminRideDetail struct {
	*models.Ride
	Rider  *RideUserInfo   `json:"rider,omitempty"`
	Driver *RideDriverInfo `json:"driver,omitempty"`
}

type RideUserInfo struct {
	ID          uuid.UUID `json:"id"`
	Email       string    `json:"email"`
	FirstName   string    `json:"first_name"`
	LastName    string    `json:"last_name"`
	PhoneNumber string    `json:"phone_number"`
}

type RideDriverInfo struct {
	ID           uuid.UUID `json:"id"`
	UserID       uuid.UUID `json:"user_id"`
	FirstName    string    `json:"first_name"`
	LastName     string    `json:"last_name"`
	PhoneNumber  string    `json:"phone_number"`
	VehicleModel string    `json:"vehicle_model"`
	VehiclePlate string    `json:"vehicle_plate"`
	VehicleColor string    `json:"vehicle_color"`
	Rating       float64   `json:"rating"`
}

type DashboardStats struct {
	Users      *UserStats `json:"users"`
	Rides      *RideStats `json:"rides"`
	TodayRides *RideStats `json:"today_rides"`
}

type RealtimeMetrics struct {
	ActiveRides        int     `json:"active_rides"`
	AvailableDrivers   int     `json:"available_drivers"`
	PendingRequests    int     `json:"pending_requests"`
	TodayRevenue       float64 `json:"today_revenue"`
	TodayRevenueChange float64 `json:"today_revenue_change"`
	OnlineDrivers      int     `json:"online_drivers"`
	TotalRidersActive  int     `json:"total_riders_active"`
	AvgWaitTime        float64 `json:"avg_wait_time"`
	AvgETA             float64 `json:"avg_eta"`
}

type DashboardSummary struct {
	Rides   *SummaryRides   `json:"rides"`
	Drivers *SummaryDrivers `json:"drivers"`
	Riders  *SummaryRiders  `json:"riders"`
	Revenue *SummaryRevenue `json:"revenue"`
	Alerts  *SummaryAlerts  `json:"alerts"`
}

type SummaryRides struct {
	Total             int     `json:"total"`
	Completed         int     `json:"completed"`
	Cancelled         int     `json:"cancelled"`
	InProgress        int     `json:"in_progress"`
	Pending           int     `json:"pending"`
	CompletionRate    float64 `json:"completion_rate"`
	CancellationRate  float64 `json:"cancellation_rate"`
	CancelledByRider  int     `json:"cancelled_by_rider"`
	CancelledByDriver int     `json:"cancelled_by_driver"`
	AvgDuration       float64 `json:"avg_duration"`
	AvgDistance       float64 `json:"avg_distance"`
	ChangeVsPrevious  float64 `json:"change_vs_previous"`
}

type SummaryDrivers struct {
	TotalActive      int     `json:"total_active"`
	OnlineNow        int     `json:"online_now"`
	AvailableNow     int     `json:"available_now"`
	BusyNow          int     `json:"busy_now"`
	PendingApprovals int     `json:"pending_approvals"`
	AvgRating        float64 `json:"avg_rating"`
	UtilizationRate  float64 `json:"utilization_rate"`
	NewSignups       int     `json:"new_signups"`
}

type SummaryRiders struct {
	TotalActive   int     `json:"total_active"`
	NewSignups    int     `json:"new_signups"`
	ActiveToday   int     `json:"active_today"`
	RetentionRate float64 `json:"retention_rate"`
}

type SummaryRevenue struct {
	Total            float64                `json:"total"`
	Commission       float64                `json:"commission"`
	DriverEarnings   float64                `json:"driver_earnings"`
	AvgFare          float64                `json:"avg_fare"`
	ChangeVsPrevious float64                `json:"change_vs_previous"`
	ByPaymentMethod  []PaymentMethodRevenue `json:"by_payment_method"`
}

type PaymentMethodRevenue struct {
	Method     string  `json:"method"`
	Amount     float64 `json:"amount"`
	Percentage float64 `json:"percentage"`
}

type SummaryAlerts struct {
	FraudAlerts           int `json:"fraud_alerts"`
	CriticalAlerts        int `json:"critical_alerts"`
	PendingInvestigations int `json:"pending_investigations"`
}

type RevenueTrend struct {
	Period          string             `json:"period"`
	GroupBy         string             `json:"group_by"`
	TotalRevenue    float64            `json:"total_revenue"`
	AvgDailyRevenue float64            `json:"avg_daily_revenue"`
	Trend           []RevenueTrendData `json:"trend"`
}

type RevenueTrendData struct {
	Date       string  `json:"date"`
	Revenue    float64 `json:"revenue"`
	Rides      int     `json:"rides"`
	AvgFare    float64 `json:"avg_fare"`
	Commission float64 `json:"commission"`
}

type ActionItems struct {
	PendingDriverApprovals *ActionDriverApprovals  `json:"pending_driver_approvals"`
	FraudAlerts            *ActionFraudAlerts      `json:"fraud_alerts"`
	NegativeFeedback       *ActionNegativeFeedback `json:"negative_feedback"`
	LowBalanceDrivers      *ActionLowBalance       `json:"low_balance_drivers"`
	ExpiredDocuments       *ActionExpiredDocs      `json:"expired_documents"`
}

type ActionDriverApprovals struct {
	Count       int                 `json:"count"`
	UrgentCount int                 `json:"urgent_count"`
	Items       []PendingDriverItem `json:"items"`
}

type PendingDriverItem struct {
	DriverID    uuid.UUID `json:"driver_id"`
	DriverName  string    `json:"driver_name"`
	SubmittedAt time.Time `json:"submitted_at"`
	DaysWaiting int       `json:"days_waiting"`
}

type ActionFraudAlerts struct {
	Count         int              `json:"count"`
	CriticalCount int              `json:"critical_count"`
	HighCount     int              `json:"high_count"`
	Items         []FraudAlertItem `json:"items"`
}

type FraudAlertItem struct {
	AlertID    uuid.UUID `json:"alert_id"`
	AlertType  string    `json:"alert_type"`
	AlertLevel string    `json:"alert_level"`
	UserID     uuid.UUID `json:"user_id"`
	CreatedAt  time.Time `json:"created_at"`
}

type ActionNegativeFeedback struct {
	Count        int                    `json:"count"`
	OneStarCount int                    `json:"one_star_count"`
	Items        []NegativeFeedbackItem `json:"items"`
}

type NegativeFeedbackItem struct {
	RideID     uuid.UUID  `json:"ride_id"`
	DriverID   *uuid.UUID `json:"driver_id,omitempty"`
	DriverName string     `json:"driver_name"`
	Rating     *int       `json:"rating,omitempty"`
	Feedback   *string    `json:"feedback,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
}

type ActionLowBalance struct {
	Count int              `json:"count"`
	Items []LowBalanceItem `json:"items"`
}

type LowBalanceItem struct {
	DriverID   uuid.UUID  `json:"driver_id"`
	DriverName string     `json:"driver_name"`
	Balance    float64    `json:"balance"`
	LastRide   *time.Time `json:"last_ride,omitempty"`
}

type ActionExpiredDocs struct {
	Count int              `json:"count"`
	Items []ExpiredDocItem `json:"items"`
}

type ExpiredDocItem struct {
	DriverID     uuid.UUID `json:"driver_id"`
	DriverName   string    `json:"driver_name"`
	DocumentType string    `json:"document_type"`
	ExpiredAt    time.Time `json:"expired_at"`
}
