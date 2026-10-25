package middleware

import (
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

func ErrorHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		duration := time.Since(start)
		statusCode := c.Writer.Status()

		fields := []zap.Field{
			zap.Int("status", statusCode),
			zap.String("method", c.Request.Method),
			zap.String("path", c.Request.URL.Path),
			zap.Duration("duration", duration),
			zap.String("client_ip", c.ClientIP()),
		}

		log := logger.WithContext(c.Request.Context())

		if len(c.Errors) > 0 {
			fields = append(fields, zap.String("errors", c.Errors.String()))
			log.Error("Request completed with errors", fields...)
		} else if statusCode >= 500 {
			log.Error("Server error", fields...)
		} else if statusCode >= 400 {
			log.Warn("Client error", fields...)
		} else {
			log.Info("Request completed successfully", fields...)
		}
	}
}
