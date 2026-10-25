package common

import (
	"net/http"

	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

func HandleServiceError(c *gin.Context, err error, fallbackMessage string) bool {
	if err == nil {
		return false
	}

	if appErr, ok := err.(*AppError); ok {
		AppErrorResponse(c, appErr)
		return true
	}

	logger.ErrorContext(c.Request.Context(), fallbackMessage,
		zap.Error(err),
	)

	ErrorResponse(c, http.StatusInternalServerError, fallbackMessage)
	return true
}

func HandleServiceErrorWithCode(c *gin.Context, err error, fallbackCode int, fallbackMessage string) bool {
	if err == nil {
		return false
	}

	if appErr, ok := err.(*AppError); ok {
		AppErrorResponse(c, appErr)
		return true
	}

	logger.ErrorContext(c.Request.Context(), fallbackMessage,
		zap.Error(err),
	)

	ErrorResponse(c, fallbackCode, fallbackMessage)
	return true
}

func ParseUUIDParam(c *gin.Context, paramName, displayName string) (uuid.UUID, bool) {
	paramValue := c.Param(paramName)
	if paramValue == "" {
		ErrorResponse(c, http.StatusBadRequest, displayName+" is required")
		return uuid.Nil, false
	}

	id, err := uuid.Parse(paramValue)
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, "invalid "+displayName)
		return uuid.Nil, false
	}

	return id, true
}

func ParseUUIDQuery(c *gin.Context, paramName, displayName string, required bool) (uuid.UUID, bool) {
	paramValue := c.Query(paramName)
	if paramValue == "" {
		if required {
			ErrorResponse(c, http.StatusBadRequest, displayName+" is required")
			return uuid.Nil, false
		}
		return uuid.Nil, true
	}

	id, err := uuid.Parse(paramValue)
	if err != nil {
		ErrorResponse(c, http.StatusBadRequest, "invalid "+displayName)
		return uuid.Nil, false
	}

	return id, true
}

func BindJSON(c *gin.Context, obj interface{}) bool {
	if err := c.ShouldBindJSON(obj); err != nil {
		ErrorResponse(c, http.StatusBadRequest, err.Error())
		return false
	}
	return true
}

func BindQuery(c *gin.Context, obj interface{}) bool {
	if err := c.ShouldBindQuery(obj); err != nil {
		ErrorResponse(c, http.StatusBadRequest, err.Error())
		return false
	}
	return true
}

func RequireUserID(c *gin.Context, getUserID func(*gin.Context) (uuid.UUID, error)) (uuid.UUID, bool) {
	userID, err := getUserID(c)
	if err != nil {
		ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return uuid.Nil, false
	}
	return userID, true
}

func ValidateNotEmpty(c *gin.Context, value, fieldName string) bool {
	if value == "" {
		ErrorResponse(c, http.StatusBadRequest, fieldName+" is required")
		return false
	}
	return true
}

func ValidatePositive(c *gin.Context, value float64, fieldName string) bool {
	if value <= 0 {
		ErrorResponse(c, http.StatusBadRequest, fieldName+" must be positive")
		return false
	}
	return true
}

func ValidateInRange(c *gin.Context, value, min, max float64, fieldName string) bool {
	if value < min || value > max {
		ErrorResponse(c, http.StatusBadRequest, fieldName+" must be between "+formatFloat(min)+" and "+formatFloat(max))
		return false
	}
	return true
}
func formatFloat(f float64) string {
	if f == float64(int64(f)) {
		return string(rune(int64(f) + '0'))
	}
	return string(rune(int64(f)))
}
