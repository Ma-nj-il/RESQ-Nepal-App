package validation

import (
	"fmt"
	"strings"

	"github.com/go-playground/validator/v10"
)

// ValidationError represents a validation error with field-level details
type ValidationError struct {
	Errors map[string]string `json:"errors"`
}

// Error implements the error interface
func (v *ValidationError) Error() string {
	var messages []string
	for field, msg := range v.Errors {
		messages = append(messages, fmt.Sprintf("%s: %s", field, msg))
	}
	return strings.Join(messages, "; ")
}

// NewValidationError creates a new ValidationError from validator.ValidationErrors
func NewValidationError(errs validator.ValidationErrors) *ValidationError {
	errors := make(map[string]string)

	for _, err := range errs {
		field := err.Field()
		errors[field] = getErrorMessage(err)
	}

	return &ValidationError{Errors: errors}
}

// getErrorMessage returns a human-readable error message for a validation error
func getErrorMessage(err validator.FieldError) string {
	field := err.Field()
	tag := err.Tag()
	param := err.Param()

	switch tag {
	case "required":
		return fmt.Sprintf("%s is required", field)
	case "email":
		return fmt.Sprintf("%s must be a valid email address", field)
	case "min":
		return fmt.Sprintf("%s must be at least %s characters long", field, param)
	case "max":
		return fmt.Sprintf("%s must be at most %s characters long", field, param)
	case "gte":
		return fmt.Sprintf("%s must be greater than or equal to %s", field, param)
	case "lte":
		return fmt.Sprintf("%s must be less than or equal to %s", field, param)
	case "gt":
		return fmt.Sprintf("%s must be greater than %s", field, param)
	case "lt":
		return fmt.Sprintf("%s must be less than %s", field, param)
	case "len":
		return fmt.Sprintf("%s must be exactly %s characters long", field, param)
	case "oneof":
		return fmt.Sprintf("%s must be one of: %s", field, param)
	case "latitude":
		return fmt.Sprintf("%s must be a valid latitude (-90 to 90)", field)
	case "longitude":
		return fmt.Sprintf("%s must be a valid longitude (-180 to 180)", field)
	case "phone":
		return fmt.Sprintf("%s must be a valid phone number in E.164 format", field)
	case "uuid":
		return fmt.Sprintf("%s must be a valid UUID", field)
	case "url":
		return fmt.Sprintf("%s must be a valid URL", field)
	case "alphanum":
		return fmt.Sprintf("%s must contain only alphanumeric characters", field)
	case "alpha":
		return fmt.Sprintf("%s must contain only alphabetic characters", field)
	case "numeric":
		return fmt.Sprintf("%s must be numeric", field)
	case "ride_status":
		return fmt.Sprintf("%s must be a valid ride status (requested, accepted, in_progress, completed, cancelled)", field)
	case "payment_method":
		return fmt.Sprintf("%s must be a valid payment method (card, wallet, cash)", field)
	case "user_role":
		return fmt.Sprintf("%s must be a valid user role (rider, driver, admin)", field)
	case "vehicle_year":
		return fmt.Sprintf("%s must be a valid vehicle year", field)
	case "future":
		return fmt.Sprintf("%s must be a future date/time", field)
	case "past":
		return fmt.Sprintf("%s must be a past date/time", field)
	default:
		return fmt.Sprintf("%s is invalid", field)
	}
}

// AddError adds a custom error message for a field
func (v *ValidationError) AddError(field, message string) {
	if v.Errors == nil {
		v.Errors = make(map[string]string)
	}
	v.Errors[field] = message
}

// HasErrors returns true if there are any validation errors
func (v *ValidationError) HasErrors() bool {
	return len(v.Errors) > 0
}

// GetFieldError returns the error message for a specific field
func (v *ValidationError) GetFieldError(field string) (string, bool) {
	msg, exists := v.Errors[field]
	return msg, exists
}
