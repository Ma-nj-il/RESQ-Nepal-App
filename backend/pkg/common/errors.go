package common

import (
	"errors"
	"net/http"
)

var (
	ErrNotFound           = errors.New("resource not found")
	ErrUnauthorized       = errors.New("unauthorized")
	ErrForbidden          = errors.New("forbidden")
	ErrBadRequest         = errors.New("bad request")
	ErrInternalServer     = errors.New("internal server error")
	ErrConflict           = errors.New("resource conflict")
	ErrValidation         = errors.New("validation error")
	ErrInvalidToken       = errors.New("invalid token")
	ErrExpiredToken       = errors.New("expired token")
	ErrInvalidCredentials = errors.New("invalid credentials")
)

const (
	ErrCodeUnauthorized       = "AUTH_UNAUTHORIZED"
	ErrCodeForbidden          = "AUTH_FORBIDDEN"
	ErrCodeInvalidToken       = "AUTH_INVALID_TOKEN"
	ErrCodeExpiredToken       = "AUTH_EXPIRED_TOKEN"
	ErrCodeInvalidCredentials = "AUTH_INVALID_CREDENTIALS"

	ErrCodeValidation = "VALIDATION_ERROR"
	ErrCodeBadRequest = "BAD_REQUEST"

	ErrCodeNotFound = "RESOURCE_NOT_FOUND"
	ErrCodeConflict = "RESOURCE_CONFLICT"

	ErrCodeRideNotAvailable = "RIDE_NOT_AVAILABLE"
	ErrCodeRideNotStarted   = "RIDE_NOT_STARTED"
	ErrCodeRideAlreadyDone  = "RIDE_ALREADY_COMPLETED"

	ErrCodePaymentFailed     = "PAYMENT_FAILED"
	ErrCodeInsufficientFunds = "PAYMENT_INSUFFICIENT_FUNDS"

	ErrCodeDriverUnauthorized = "DRIVER_UNAUTHORIZED"
	ErrCodeDriverUnavailable  = "DRIVER_UNAVAILABLE"

	ErrCodeInternal           = "INTERNAL_ERROR"
	ErrCodeServiceUnavailable = "SERVICE_UNAVAILABLE"
	ErrCodeRateLimited        = "RATE_LIMITED"
)

type AppError struct {
	Code      int    `json:"code"`
	ErrorCode string `json:"error_code,omitempty"`
	Message   string `json:"message"`
	Err       error  `json:"-"`
}

func (e *AppError) Error() string {
	if e.Err != nil {
		return e.Err.Error()
	}
	return e.Message
}

func NewAppError(code int, message string, err error) *AppError {
	return &AppError{
		Code:    code,
		Message: message,
		Err:     err,
	}
}

func NewNotFoundError(message string, err error) *AppError {
	return &AppError{
		Code:      http.StatusNotFound,
		ErrorCode: ErrCodeNotFound,
		Message:   message,
		Err:       err,
	}
}

func NewUnauthorizedError(message string) *AppError {
	return &AppError{
		Code:      http.StatusUnauthorized,
		ErrorCode: ErrCodeUnauthorized,
		Message:   message,
		Err:       ErrUnauthorized,
	}
}

func NewBadRequestError(message string, err error) *AppError {
	return &AppError{
		Code:      http.StatusBadRequest,
		ErrorCode: ErrCodeBadRequest,
		Message:   message,
		Err:       err,
	}
}

func NewInternalError(message string, err error) *AppError {
	return &AppError{
		Code:      http.StatusInternalServerError,
		ErrorCode: ErrCodeInternal,
		Message:   message,
		Err:       err,
	}
}

func NewInternalErrorWithError(message string, err error) *AppError {
	return &AppError{
		Code:      http.StatusInternalServerError,
		ErrorCode: ErrCodeInternal,
		Message:   message,
		Err:       err,
	}
}

func NewInternalServerError(message string) *AppError {
	return &AppError{
		Code:      http.StatusInternalServerError,
		ErrorCode: ErrCodeInternal,
		Message:   message,
		Err:       ErrInternalServer,
	}
}

func NewConflictError(message string) *AppError {
	return &AppError{
		Code:      http.StatusConflict,
		ErrorCode: ErrCodeConflict,
		Message:   message,
		Err:       ErrConflict,
	}
}

func NewValidationError(message string) *AppError {
	return &AppError{
		Code:      http.StatusBadRequest,
		ErrorCode: ErrCodeValidation,
		Message:   message,
		Err:       ErrValidation,
	}
}

func NewServiceUnavailableError(message string) *AppError {
	return &AppError{
		Code:      http.StatusServiceUnavailable,
		ErrorCode: ErrCodeServiceUnavailable,
		Message:   message,
		Err:       errors.New("service unavailable"),
	}
}

func NewTooManyRequestsError(message string) *AppError {
	return &AppError{
		Code:      http.StatusTooManyRequests,
		ErrorCode: ErrCodeRateLimited,
		Message:   message,
		Err:       errors.New("rate limit exceeded"),
	}
}

func NewForbiddenError(message string) *AppError {
	return &AppError{
		Code:      http.StatusForbidden,
		ErrorCode: ErrCodeForbidden,
		Message:   message,
		Err:       ErrForbidden,
	}
}

func NewErrorWithCode(httpCode int, errorCode, message string, err error) *AppError {
	return &AppError{
		Code:      httpCode,
		ErrorCode: errorCode,
		Message:   message,
		Err:       err,
	}
}
