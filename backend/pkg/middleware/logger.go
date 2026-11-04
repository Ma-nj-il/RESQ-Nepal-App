package middleware

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
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
			zap.String("query", sanitizeQuery(c.Request.URL.RawQuery)),
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
	var value interface{}
	if err := json.Unmarshal(payload, &value); err != nil {
		return "[non-JSON payload omitted]"
	}
	redactLogValue(value)
	redacted, err := json.Marshal(value)
	if err != nil {
		return "[payload omitted]"
	}

	sanitized := security.StripHTMLTags(string(redacted))
	sanitized = security.SanitizeString(sanitized)
	sanitized = strings.Join(strings.Fields(sanitized), " ")

	const maxPayloadLength = 512
	if len(sanitized) > maxPayloadLength {
		sanitized = sanitized[:maxPayloadLength] + "...(truncated)"
	}
	return sanitized
}

func sanitizeQuery(rawQuery string) string {
	if rawQuery == "" {
		return ""
	}
	values, err := url.ParseQuery(rawQuery)
	if err != nil {
		return "[query omitted]"
	}
	for key := range values {
		if isSensitiveLogKey(key) {
			values[key] = []string{"[REDACTED]"}
		}
	}
	return values.Encode()
}

func redactLogValue(value interface{}) {
	switch typed := value.(type) {
	case map[string]interface{}:
		for key, child := range typed {
			if isSensitiveLogKey(key) {
				typed[key] = "[REDACTED]"
				continue
			}
			redactLogValue(child)
		}
	case []interface{}:
		for _, child := range typed {
			redactLogValue(child)
		}
	}
}

func isSensitiveLogKey(key string) bool {
	key = strings.ToLower(strings.TrimSpace(key))
	return key == "email" || key == "phone_number" || key == "code_hash" ||
		strings.Contains(key, "password") || strings.Contains(key, "token") ||
		strings.Contains(key, "recovery_code")
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
