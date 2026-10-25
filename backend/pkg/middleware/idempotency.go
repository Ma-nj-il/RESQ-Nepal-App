package middleware

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/common"
	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	redisClient "github.com/bikky-kc013/medi-ambulance/pkg/redis"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

const (
	IdempotencyKeyHeader = "Idempotency-Key"
	idempotencyTTL       = 24 * time.Hour
	idempotencyPrefix    = "idempotency:"
)

type idempotencyEntry struct {
	StatusCode  int               `json:"status_code"`
	Headers     map[string]string `json:"headers"`
	Body        json.RawMessage   `json:"body"`
	RequestHash string            `json:"request_hash"`
}

type idempotencyResponseWriter struct {
	gin.ResponseWriter
	body       *bytes.Buffer
	statusCode int
}

func (w *idempotencyResponseWriter) Write(b []byte) (int, error) {
	w.body.Write(b)
	return w.ResponseWriter.Write(b)
}

func (w *idempotencyResponseWriter) WriteHeader(code int) {
	w.statusCode = code
	w.ResponseWriter.WriteHeader(code)
}

func Idempotency(redis redisClient.ClientInterface) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Method != http.MethodPost && c.Request.Method != http.MethodPatch && c.Request.Method != http.MethodPut {
			c.Next()
			return
		}

		idempotencyKey := c.GetHeader(IdempotencyKeyHeader)
		if idempotencyKey == "" {
			c.Next()
			return
		}

		bodyBytes, err := io.ReadAll(c.Request.Body)
		if err != nil {
			common.ErrorResponse(c, http.StatusBadRequest, "failed to read request body")
			c.Abort()
			return
		}
		c.Request.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))

		requestHash := hashRequest(c.Request.Method, c.FullPath(), bodyBytes)

		userID := ""
		if uid, err := GetUserID(c); err == nil {
			userID = uid.String()
		}

		redisKey := fmt.Sprintf("%s%s:%s", idempotencyPrefix, userID, idempotencyKey)

		cached, err := redis.GetString(c.Request.Context(), redisKey)
		if err == nil && cached != "" {
			var entry idempotencyEntry
			if err := json.Unmarshal([]byte(cached), &entry); err == nil {
				if entry.RequestHash != requestHash {
					common.ErrorResponse(c, http.StatusUnprocessableEntity,
						"Idempotency-Key has already been used with a different request")
					c.Abort()
					return
				}

				for k, v := range entry.Headers {
					c.Header(k, v)
				}
				c.Header("Idempotent-Replayed", "true")
				c.Data(entry.StatusCode, "application/json; charset=utf-8", entry.Body)
				c.Abort()
				return
			}
		}

		writer := &idempotencyResponseWriter{
			ResponseWriter: c.Writer,
			body:           &bytes.Buffer{},
			statusCode:     http.StatusOK,
		}
		c.Writer = writer

		c.Next()

		if writer.statusCode >= 200 && writer.statusCode < 300 {
			headers := map[string]string{
				"Content-Type": c.Writer.Header().Get("Content-Type"),
			}

			entry := idempotencyEntry{
				StatusCode:  writer.statusCode,
				Headers:     headers,
				Body:        writer.body.Bytes(),
				RequestHash: requestHash,
			}

			data, err := json.Marshal(entry)
			if err == nil {
				if err := redis.SetWithExpiration(c.Request.Context(), redisKey, data, idempotencyTTL); err != nil {
					logger.WarnContext(c.Request.Context(), "failed to cache idempotency response",
						zap.String("key", idempotencyKey),
						zap.Error(err),
					)
				}
			}
		}
	}
}

func hashRequest(method, path string, body []byte) string {
	h := sha256.New()
	h.Write([]byte(method))
	h.Write([]byte(path))
	h.Write(body)
	return hex.EncodeToString(h.Sum(nil))
}
