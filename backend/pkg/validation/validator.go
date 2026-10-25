package validation

import (
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/go-playground/validator/v10"
)

var (
	Validate *validator.Validate

	emailRegex = regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)
	phoneRegex = regexp.MustCompile(`^\+?[1-9]\d{1,14}$`)
)

func init() {
	Validate = validator.New()

	_ = Validate.RegisterValidation("latitude", validateLatitude)
	_ = Validate.RegisterValidation("longitude", validateLongitude)
	_ = Validate.RegisterValidation("phone", validatePhone)
	_ = Validate.RegisterValidation("future", validateFutureTime)
	_ = Validate.RegisterValidation("past", validatePastTime)
	_ = Validate.RegisterValidation("ride_status", validateRideStatus)
	_ = Validate.RegisterValidation("payment_method", validatePaymentMethod)
	_ = Validate.RegisterValidation("user_role", validateUserRole)
	_ = Validate.RegisterValidation("vehicle_year", validateVehicleYear)
}

func ValidateStruct(s interface{}) error {
	err := Validate.Struct(s)
	if err != nil {
		if validationErrors, ok := err.(validator.ValidationErrors); ok {
			return NewValidationError(validationErrors)
		}
		return err
	}
	return nil
}

func validateLatitude(fl validator.FieldLevel) bool {
	latitude := fl.Field().Float()
	return latitude >= -90.0 && latitude <= 90.0
}

func validateLongitude(fl validator.FieldLevel) bool {
	longitude := fl.Field().Float()
	return longitude >= -180.0 && longitude <= 180.0
}

func validatePhone(fl validator.FieldLevel) bool {
	phone := fl.Field().String()
	return phoneRegex.MatchString(phone)
}

func validateFutureTime(fl validator.FieldLevel) bool {
	return true
}

func validatePastTime(fl validator.FieldLevel) bool {
	return true
}

func validateRideStatus(fl validator.FieldLevel) bool {
	status := fl.Field().String()
	validStatuses := []string{"requested", "accepted", "in_progress", "completed", "cancelled"}
	return contains(validStatuses, status)
}

func validatePaymentMethod(fl validator.FieldLevel) bool {
	method := fl.Field().String()
	validMethods := []string{"cash"}
	return contains(validMethods, method)
}

func validateUserRole(fl validator.FieldLevel) bool {
	role := fl.Field().String()
	validRoles := []string{"rider", "driver", "admin"}
	return contains(validRoles, role)
}

func validateVehicleYear(fl validator.FieldLevel) bool {
	year := fl.Field().Int()
	currentYear := int64(time.Now().Year())
	return year >= 1900 && year <= currentYear+1
}

func contains(slice []string, item string) bool {
	item = strings.ToLower(strings.TrimSpace(item))
	for _, s := range slice {
		if strings.ToLower(strings.TrimSpace(s)) == item {
			return true
		}
	}
	return false
}

func ValidateEmail(email string) bool {
	email = strings.TrimSpace(email)
	return len(email) > 0 && emailRegex.MatchString(email)
}

func ValidatePhoneNumber(phone string) bool {
	phone = strings.TrimSpace(phone)
	return phoneRegex.MatchString(phone)
}

func ValidateCoordinates(latitude, longitude float64) error {
	if latitude < -90.0 || latitude > 90.0 {
		return fmt.Errorf("latitude must be between -90 and 90, got: %f", latitude)
	}
	if longitude < -180.0 || longitude > 180.0 {
		return fmt.Errorf("longitude must be between -180 and 180, got: %f", longitude)
	}
	return nil
}

func ValidateDistance(distance float64) error {
	if distance < 0 {
		return fmt.Errorf("distance cannot be negative: %f", distance)
	}
	if distance > 10000 {
		return fmt.Errorf("distance exceeds maximum allowed: %f", distance)
	}
	return nil
}

func ValidateAmount(amount float64) error {
	if amount < 0 {
		return fmt.Errorf("amount cannot be negative: %f", amount)
	}
	if amount > 100000 {
		return fmt.Errorf("amount exceeds maximum allowed: %f", amount)
	}
	return nil
}

func ValidateRating(rating int) error {
	if rating < 1 || rating > 5 {
		return fmt.Errorf("rating must be between 1 and 5, got: %d", rating)
	}
	return nil
}

func ValidateStringLength(s string, min, max int) error {
	length := len(strings.TrimSpace(s))
	if length < min {
		return fmt.Errorf("string length must be at least %d characters, got: %d", min, length)
	}
	if max > 0 && length > max {
		return fmt.Errorf("string length must be at most %d characters, got: %d", max, length)
	}
	return nil
}

func ValidateUUID(uuid string) bool {
	uuidRegex := regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	return uuidRegex.MatchString(uuid)
}
