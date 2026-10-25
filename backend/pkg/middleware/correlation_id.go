package middleware

import (
	"strings"

	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const (
	CorrelationIDHeader = "X-Request-ID"
	CorrelationIDKey    = "correlation_id"
)

func CorrelationID() gin.HandlerFunc {
	return func(c *gin.Context) {
		correlationID := strings.TrimSpace(c.GetHeader(CorrelationIDHeader))

		if correlationID != "" {
			if _, err := uuid.Parse(correlationID); err != nil {
				correlationID = ""
			}
		}

		if correlationID == "" {
			correlationID = uuid.New().String()
		}

		c.Set(CorrelationIDKey, correlationID)

		ctx := logger.ContextWithCorrelationID(c.Request.Context(), correlationID)
		c.Request = c.Request.WithContext(ctx)

		c.Writer.Header().Set(CorrelationIDHeader, correlationID)

		c.Next()
	}
}

func GetCorrelationID(c *gin.Context) string {
	if id, exists := c.Get(CorrelationIDKey); exists {
		if correlationID, ok := id.(string); ok {
			return correlationID
		}
	}
	return logger.CorrelationIDFromContext(c.Request.Context())
}
