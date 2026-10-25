package middleware

import (
	"bytes"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	"github.com/bikky-kc013/medi-ambulance/pkg/security"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

type zapWriter struct {
	log   *zap.Logger
	level string
}

func (z zapWriter) Write(p []byte) (n int, err error) {
	msg := strings.TrimSpace(string(p))
	switch z.level {
	case "info":
		z.log.Info(msg)
	case "error":
		z.log.Error(msg)
	default:
		z.log.Info(msg)
	}
	return len(p), nil
}

type responseRecorder struct {
	gin.ResponseWriter
	body *bytes.Buffer
}

func (r *responseRecorder) Write(data []byte) (int, error) {
	r.body.Write(data)
	return r.ResponseWriter.Write(data)
}

func (r *responseRecorder) WriteString(data string) (int, error) {
	r.body.WriteString(data)
	return r.ResponseWriter.WriteString(data)
}

func RequestLogger(serviceName string) gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if r := recover(); r != nil {
				logger.PanicContext(c.Request.Context(), "Panic in request", zap.Any("panic", r))
				c.AbortWithStatus(http.StatusInternalServerError)
			}
		}()

		var requestBody string
		if c.Request.Body != nil {
			bodyBytes, _ := io.ReadAll(c.Request.Body)
			c.Request.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))
			requestBody = sanitizePayload(bodyBytes)
		}

		recorder := &responseRecorder{ResponseWriter: c.Writer, body: &bytes.Buffer{}}
		c.Writer = recorder

		start := time.Now()
		c.Next()
		duration := time.Since(start)

		status := c.Writer.Status()
		fields := []zap.Field{
			zap.String("service", serviceName),
			zap.String("method", c.Request.Method),
			zap.String("path", c.Request.URL.Path),
			zap.String("query", c.Request.URL.RawQuery),
			zap.String("ip", c.ClientIP()),
			zap.Int("status", status),
			zap.Duration("latency", duration),
			zap.Int("response_size", recorder.body.Len()),
		}

		if requestBody != "" {
			fields = append(fields, zap.String("request_body", requestBody))
		}

		if responseBody := sanitizePayload(recorder.body.Bytes()); responseBody != "" {
			fields = append(fields, zap.String("response_body", responseBody))
		}

		if len(c.Errors) > 0 {
			fields = append(fields, zap.String("errors", c.Errors.String()))
			logger.ErrorContext(c.Request.Context(), "Request completed with errors", fields...)
		} else if status >= 500 {
			logger.ErrorContext(c.Request.Context(), "Server error response", fields...)
		} else if status >= 400 {
			logger.WarnContext(c.Request.Context(), "Client error response", fields...)
		} else {
			logger.InfoContext(c.Request.Context(), "Request completed successfully", fields...)
		}
	}
}

func sanitizePayload(payload []byte) string {
	if len(payload) == 0 {
		return ""
	}
	sanitized := security.StripHTMLTags(string(payload))
	sanitized = security.SanitizeString(sanitized)
	sanitized = strings.Join(strings.Fields(sanitized), " ")

	const maxPayloadLength = 512
	if len(sanitized) > maxPayloadLength {
		sanitized = sanitized[:maxPayloadLength] + "...(truncated)"
	}
	return sanitized
}

func NewGinRouter(log *zap.Logger) *gin.Engine {
	gin.SetMode(gin.DebugMode)

	r := gin.New()

	gin.DefaultWriter = zapWriter{log: log, level: "info"}
	gin.DefaultErrorWriter = zapWriter{log: log, level: "error"}

	r.Use(gin.Recovery())
	r.Use(RequestLogger("AdminService"))

	return r
}
