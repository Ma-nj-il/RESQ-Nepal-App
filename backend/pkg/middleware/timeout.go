package middleware

import (
	"net/http"
	"strings"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/config"
	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	"github.com/gin-contrib/timeout"
	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"go.uber.org/zap"
)

var (
	timeoutCounter = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "http_request_timeouts_total",
			Help: "Total number of HTTP request timeouts by method and route",
		},
		[]string{"method", "route"},
	)
)

func RequestTimeout(timeoutConfig *config.TimeoutConfig) gin.HandlerFunc {
	return func(c *gin.Context) {

		if strings.EqualFold(c.GetHeader("Upgrade"), "websocket") {
			c.Next()
			return
		}

		defer func() {
			if r := recover(); r != nil {
				logger.WithContext(c.Request.Context()).Error("Panic in timeout middleware",
					zap.Any("panic", r),
					zap.String("path", c.Request.URL.Path),
					zap.String("method", c.Request.Method),
				)
				if !c.Writer.Written() {
					c.AbortWithStatus(http.StatusInternalServerError)
				}
			}
		}()

		routePath := c.FullPath()
		if routePath == "" {
			routePath = c.Request.URL.Path
		}

		if timeoutConfig == nil {
			timeoutConfig = &config.TimeoutConfig{
				DefaultRequestTimeout: 30, // 30 seconds default
			}
		}

		timeoutDuration := timeoutConfig.TimeoutForRoute(c.Request.Method, routePath)
		if timeoutDuration <= 0 {
			timeoutDuration = 30 * time.Second
		}

		timeoutResponse := func(c *gin.Context) {
			c.Writer.Header().Set("X-Timeout", "true")

			if correlationID := GetCorrelationID(c); correlationID != "" {
				c.Writer.Header().Set(CorrelationIDHeader, correlationID)
			}

			if !c.Writer.Written() {
				c.Abort()
				c.JSON(http.StatusGatewayTimeout, gin.H{
					"error":   "Request timeout",
					"message": "The request took too long to process",
				})

				logger.WithContext(c.Request.Context()).Warn("Request timeout",
					zap.String("path", c.Request.URL.Path),
					zap.String("method", c.Request.Method),
					zap.Duration("timeout", timeoutDuration),
				)

				timeoutCounter.WithLabelValues(c.Request.Method, routePath).Inc()
			}
		}

		timeoutMiddleware := timeout.New(
			timeout.WithTimeout(timeoutDuration),
			timeout.WithResponse(timeoutResponse),
		)

		timeoutMiddleware(c)
	}
}
