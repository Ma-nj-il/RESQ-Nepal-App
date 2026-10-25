package common

import (
	"net/http"

	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

type Response struct {
	Success       bool        `json:"success"`
	Data          interface{} `json:"data,omitempty"`
	Error         *ErrorInfo  `json:"error,omitempty"`
	Meta          *Meta       `json:"meta,omitempty"`
	CorrelationID string      `json:"correlation_id,omitempty"`
}

type ErrorInfo struct {
	Code      int    `json:"code"`
	ErrorCode string `json:"error_code,omitempty"`
	Message   string `json:"message"`
}

type Meta struct {
	Limit      int         `json:"limit,omitempty"`
	Offset     int         `json:"offset,omitempty"`
	Total      int64       `json:"total,omitempty"`
	TotalPages int         `json:"total_pages,omitempty"`
	Stats      interface{} `json:"stats,omitempty"`
}

func SuccessResponse(c *gin.Context, data interface{}) {
	c.JSON(http.StatusOK, Response{
		Success: true,
		Data:    data,
	})
}

func SuccessResponseWithStatus(c *gin.Context, statusCode int, data interface{}, message string) {
	c.JSON(statusCode, Response{
		Success: true,
		Data:    data,
	})
}

func SuccessResponseWithMeta(c *gin.Context, data interface{}, meta *Meta) {
	c.JSON(http.StatusOK, Response{
		Success: true,
		Data:    data,
		Meta:    meta,
	})
}

func SuccessResponseWithMetaAndStatus(c *gin.Context, statusCode int, data interface{}, meta *Meta, message string) {
	c.JSON(statusCode, Response{
		Success: true,
		Data:    data,
		Meta:    meta,
	})
}

func CreatedResponse(c *gin.Context, data interface{}) {
	c.JSON(http.StatusCreated, Response{
		Success: true,
		Data:    data,
	})
}

func ErrorResponse(c *gin.Context, statusCode int, message string) {
	c.JSON(statusCode, Response{
		Success: false,
		Error: &ErrorInfo{
			Code:    statusCode,
			Message: message,
		},
		CorrelationID: logger.CorrelationIDFromContext(c.Request.Context()),
	})

	logger.WithContext(c.Request.Context()).Error("API Error",
		zap.Int("status", statusCode),
		zap.String("message", message),
		zap.String("path", c.Request.URL.Path),
		zap.String("method", c.Request.Method),
	)
}

func NoRouteHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusNotFound, Response{
			Success: false,
			Error: &ErrorInfo{
				Code:      http.StatusNotFound,
				ErrorCode: ErrCodeNotFound,
				Message:   "route not found",
			},
			CorrelationID: logger.CorrelationIDFromContext(c.Request.Context()),
		})
	}
}

func NoMethodHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusMethodNotAllowed, Response{
			Success: false,
			Error: &ErrorInfo{
				Code:    http.StatusMethodNotAllowed,
				Message: "method not allowed",
			},
			CorrelationID: logger.CorrelationIDFromContext(c.Request.Context()),
		})
	}
}

func AppErrorResponse(c *gin.Context, err *AppError) {
	c.JSON(err.Code, Response{
		Success: false,
		Error: &ErrorInfo{
			Code:      err.Code,
			ErrorCode: err.ErrorCode,
			Message:   err.Message,
		},
		CorrelationID: logger.CorrelationIDFromContext(c.Request.Context()),
	})

	logger.WithContext(c.Request.Context()).Error("Application Error",
		zap.Int("status", err.Code),
		zap.String("error_code", err.ErrorCode),
		zap.String("message", err.Message),
		zap.String("path", c.Request.URL.Path),
		zap.String("method", c.Request.Method),
	)
}
