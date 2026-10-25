package validation

import "time"

type CreateRideRequest struct {
	PickupLatitude   float64    `json:"pickup_latitude" validate:"required,latitude"`
	PickupLongitude  float64    `json:"pickup_longitude" validate:"required,longitude"`
	PickupAddr       string     `json:"pickup_address" validate:"required,min=5,max=500"`
	DropoffLatitude  float64    `json:"dropoff_latitude" validate:"required,latitude"`
	DropoffLongitude float64    `json:"dropoff_longitude" validate:"required,longitude"`
	DropoffAddr      string     `json:"dropoff_address" validate:"required,min=5,max=500"`
	RideType         string     `json:"ride_type" validate:"required,oneof=economy premium xl"`
	PromoCode        string     `json:"promo_code" validate:"omitempty,alphanum,max=20"`
	ScheduledFor     *time.Time `json:"scheduled_for" validate:"omitempty"`
}

type RegisterUserRequest struct {
	Email       string `json:"email" validate:"required,email,max=255"`
	PhoneNumber string `json:"phone_number" validate:"required,phone,max=20"`
	Password    string `json:"password" validate:"required,min=8,max=72"`
	FirstName   string `json:"first_name" validate:"required,min=1,max=100"`
	LastName    string `json:"last_name" validate:"required,min=1,max=100"`
	Role        string `json:"role" validate:"required,user_role"`
}

type LoginRequest struct {
	Email    string `json:"email" validate:"required,email"`
	Password string `json:"password" validate:"required,min=8"`
}

type UpdateLocationRequest struct {
	Latitude  float64 `json:"latitude" validate:"required,latitude"`
	Longitude float64 `json:"longitude" validate:"required,longitude"`
}

type CreatePaymentRequest struct {
	RideID  string  `json:"ride_id" validate:"required,uuid"`
	Amount  float64 `json:"amount" validate:"required,gt=0,lte=100000"`
	Method  string  `json:"method" validate:"required,payment_method"`
	TokenID string  `json:"token_id" validate:"omitempty,min=1,max=255"`
}

type UpdateRideStatusRequest struct {
	Status string `json:"status" validate:"required,ride_status"`
	Reason string `json:"reason" validate:"omitempty,max=500"`
}

type RatingRequest struct {
	RideID   string `json:"ride_id" validate:"required,uuid"`
	Rating   int    `json:"rating" validate:"required,gte=1,lte=5"`
	Feedback string `json:"feedback" validate:"omitempty,max=1000"`
}

type CreateDriverRequest struct {
	UserID        string `json:"user_id" validate:"required,uuid"`
	LicenseNumber string `json:"license_number" validate:"required,alphanum,min=5,max=50"`
	VehicleModel  string `json:"vehicle_model" validate:"required,min=2,max=100"`
	VehiclePlate  string `json:"vehicle_plate" validate:"required,alphanum,min=2,max=20"`
	VehicleColor  string `json:"vehicle_color" validate:"required,min=2,max=50"`
	VehicleYear   int    `json:"vehicle_year" validate:"required,vehicle_year"`
}

type CreatePromoCodeRequest struct {
	Code             string    `json:"code" validate:"required,alphanum,min=3,max=20"`
	DiscountType     string    `json:"discount_type" validate:"required,oneof=percentage fixed"`
	DiscountValue    float64   `json:"discount_value" validate:"required,gt=0"`
	MaxUsage         int       `json:"max_usage" validate:"required,gte=1"`
	MaxDiscountValue float64   `json:"max_discount_value" validate:"omitempty,gt=0"`
	MinRideAmount    float64   `json:"min_ride_amount" validate:"omitempty,gte=0"`
	ValidFrom        time.Time `json:"valid_from" validate:"required"`
	ValidUntil       time.Time `json:"valid_until" validate:"required"`
}

type UpdateProfileRequest struct {
	FirstName    string `json:"first_name" validate:"omitempty,min=1,max=100"`
	LastName     string `json:"last_name" validate:"omitempty,min=1,max=100"`
	PhoneNumber  string `json:"phone_number" validate:"omitempty,phone"`
	ProfileImage string `json:"profile_image" validate:"omitempty,url"`
}

type PaginationRequest struct {
	Limit   int    `json:"limit" validate:"omitempty,gte=1,lte=100"`
	Offset  int    `json:"offset" validate:"omitempty,gte=0"`
	SortBy  string `json:"sort_by" validate:"omitempty,alpha"`
	SortDir string `json:"sort_dir" validate:"omitempty,oneof=asc desc"`
}

type DateRangeRequest struct {
	StartDate time.Time `json:"start_date" validate:"omitempty"`
	EndDate   time.Time `json:"end_date" validate:"omitempty"`
}

func ValidateRideRequest(req *CreateRideRequest) error {
	if err := ValidateStruct(req); err != nil {
		return err
	}

	validationErr := &ValidationError{Errors: make(map[string]string)}

	if req.PickupLatitude == req.DropoffLatitude && req.PickupLongitude == req.DropoffLongitude {
		validationErr.AddError("location", "Pickup and dropoff locations cannot be the same")
	}

	if req.ScheduledFor != nil && req.ScheduledFor.Before(time.Now()) {
		validationErr.AddError("scheduled_for", "Scheduled time must be in the future")
	}

	if validationErr.HasErrors() {
		return validationErr
	}

	return nil
}

func ValidatePasswordStrength(password string) error {
	validationErr := &ValidationError{Errors: make(map[string]string)}

	if len(password) < 8 {
		validationErr.AddError("password", "Password must be at least 8 characters long")
	}

	if validationErr.HasErrors() {
		return validationErr
	}

	return nil
}

func ValidateDateRange(start, end time.Time) error {
	if end.Before(start) {
		return &ValidationError{
			Errors: map[string]string{
				"date_range": "End date must be after start date",
			},
		}
	}
	return nil
}
