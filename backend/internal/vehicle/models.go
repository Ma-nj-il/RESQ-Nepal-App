package vehicle

import (
	"time"

	"github.com/google/uuid"
)

type VehicleStatus string

const (
	VehicleStatusPending   VehicleStatus = "pending"
	VehicleStatusApproved  VehicleStatus = "approved"
	VehicleStatusRejected  VehicleStatus = "rejected"
	VehicleStatusSuspended VehicleStatus = "suspended"
	VehicleStatusRetired   VehicleStatus = "retired"
)

type VehicleCategory string

const (
	VehicleCategoryEconomy  VehicleCategory = "economy"
	VehicleCategoryComfort  VehicleCategory = "comfort"
	VehicleCategoryPremium  VehicleCategory = "premium"
	VehicleCategoryLux      VehicleCategory = "lux"
	VehicleCategoryXL       VehicleCategory = "xl"
	VehicleCategoryWAV      VehicleCategory = "wav"
	VehicleCategoryElectric VehicleCategory = "electric"
)

type FuelType string

const (
	FuelTypeGasoline FuelType = "gasoline"
	FuelTypeDiesel   FuelType = "diesel"
	FuelTypeElectric FuelType = "electric"
	FuelTypeHybrid   FuelType = "hybrid"
	FuelTypeCNG      FuelType = "cng"
	FuelTypeLPG      FuelType = "lpg"
)

type Vehicle struct {
	ID       uuid.UUID       `json:"id" gorm:"type:uuid;primaryKey"`
	DriverID uuid.UUID       `json:"driver_id" gorm:"type:uuid;index"`
	Status   VehicleStatus   `json:"status" gorm:"not null"`
	Category VehicleCategory `json:"category" gorm:"not null"`

	Make         string  `json:"make" gorm:"not null"`
	Model        string  `json:"model" gorm:"not null"`
	Year         int     `json:"year" gorm:"not null"`
	Color        string  `json:"color" gorm:"not null"`
	LicensePlate string  `json:"license_plate" gorm:"unique;not null"`
	VIN          *string `json:"vin,omitempty" gorm:"unique"`

	FuelType            FuelType `json:"fuel_type" gorm:"not null"`
	MaxPassengers       int      `json:"max_passengers" gorm:"not null"`
	HasWheelchairAccess bool     `json:"has_wheelchair_access" gorm:"not null;default:false"`

	RegistrationPhotoURL *string `json:"registration_photo_url,omitempty"`
	InsurancePhotoURL    *string `json:"insurance_photo_url,omitempty"`
	FrontPhotoURL        *string `json:"front_photo_url,omitempty"`
	BackPhotoURL         *string `json:"back_photo_url,omitempty"`
	SidePhotoURL         *string `json:"side_photo_url,omitempty"`
	InteriorPhotoURL     *string `json:"interior_photo_url,omitempty"`

	InsuranceExpiry    *time.Time `json:"insurance_expiry,omitempty"`
	RegistrationExpiry *time.Time `json:"registration_expiry,omitempty"`
	InspectionExpiry   *time.Time `json:"inspection_expiry,omitempty"`

	RejectionReason *string `json:"rejection_reason,omitempty"`
	IsActive        bool    `json:"is_active" gorm:"not null;default:true"`
	IsPrimary       bool    `json:"is_primary" gorm:"not null;default:false"`

	CreatedAt time.Time `json:"created_at" gorm:"not null"`
	UpdatedAt time.Time `json:"updated_at" gorm:"not null"`
}

type VehicleInspection struct {
	ID          uuid.UUID  `json:"id" gorm:"type:uuid;primaryKey"`
	VehicleID   uuid.UUID  `json:"vehicle_id" gorm:"type:uuid;index"`
	InspectorID *uuid.UUID `json:"inspector_id,omitempty" gorm:"type:uuid;index"`
	Status      string     `json:"status" gorm:"not null"`
	ScheduledAt time.Time  `json:"scheduled_at" gorm:"not null"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
	Notes       *string    `json:"notes,omitempty"`
	FailReasons []string   `json:"fail_reasons,omitempty" gorm:"serializer:json"`
	CreatedAt   time.Time  `json:"created_at" gorm:"not null"`
}

type MaintenanceReminder struct {
	ID          uuid.UUID  `json:"id" gorm:"type:uuid;primaryKey"`
	VehicleID   uuid.UUID  `json:"vehicle_id" gorm:"type:uuid;index"`
	Type        string     `json:"type" gorm:"not null"`
	Description string     `json:"description" gorm:"not null"`
	DueDate     *time.Time `json:"due_date,omitempty"`
	DueMileage  *int       `json:"due_mileage,omitempty"`
	IsCompleted bool       `json:"is_completed" gorm:"not null;default:false"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at" gorm:"not null"`
}

type RegisterVehicleRequest struct {
	Make                string          `json:"make" binding:"required"`
	Model               string          `json:"model" binding:"required"`
	Year                int             `json:"year" binding:"required"`
	Color               string          `json:"color" binding:"required"`
	LicensePlate        string          `json:"license_plate" binding:"required"`
	VIN                 *string         `json:"vin,omitempty"`
	Category            VehicleCategory `json:"category" binding:"required"`
	FuelType            FuelType        `json:"fuel_type" binding:"required"`
	MaxPassengers       int             `json:"max_passengers"`
	HasWheelchairAccess bool            `json:"has_wheelchair_access"`
}

type UpdateVehicleRequest struct {
	Color               *string          `json:"color,omitempty"`
	Category            *VehicleCategory `json:"category,omitempty"`
	MaxPassengers       *int             `json:"max_passengers,omitempty"`
	HasChildSeat        *bool            `json:"has_child_seat,omitempty"`
	HasWheelchairAccess *bool            `json:"has_wheelchair_access,omitempty"`
	HasWifi             *bool            `json:"has_wifi,omitempty"`
	HasCharger          *bool            `json:"has_charger,omitempty"`
	PetFriendly         *bool            `json:"pet_friendly,omitempty"`
	LuggageCapacity     *int             `json:"luggage_capacity,omitempty"`
}

type UploadVehiclePhotosRequest struct {
	RegistrationPhotoURL *string `json:"registration_photo_url,omitempty"`
	InsurancePhotoURL    *string `json:"insurance_photo_url,omitempty"`
	FrontPhotoURL        *string `json:"front_photo_url,omitempty"`
	BackPhotoURL         *string `json:"back_photo_url,omitempty"`
	SidePhotoURL         *string `json:"side_photo_url,omitempty"`
	InteriorPhotoURL     *string `json:"interior_photo_url,omitempty"`
}

type AdminReviewRequest struct {
	Approved        bool    `json:"approved"`
	RejectionReason *string `json:"rejection_reason,omitempty"`
}

type VehicleListResponse struct {
	Vehicles []Vehicle `json:"vehicles"`
	Count    int       `json:"count"`
}

type VehicleStats struct {
	TotalVehicles        int `json:"total_vehicles"`
	PendingReview        int `json:"pending_review"`
	ApprovedVehicles     int `json:"approved_vehicles"`
	SuspendedVehicles    int `json:"suspended_vehicles"`
	ExpiringInsurance    int `json:"expiring_insurance"`
	ExpiringRegistration int `json:"expiring_registration"`
}
