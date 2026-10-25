package middleware

import (
	"bytes"
	"io"
	"net/http"
	"reflect"

	"github.com/bikky-kc013/medi-ambulance/pkg/validation"
	"github.com/gin-gonic/gin"
)

func ValidateRequest(requestType interface{}) gin.HandlerFunc {
	t := reflect.TypeOf(requestType)
	if t.Kind() == reflect.Ptr {
		t = t.Elem()
	}

	return func(c *gin.Context) {
		req := reflect.New(t).Interface()

		if err := c.ShouldBindJSON(req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":   "Invalid request format",
				"details": err.Error(),
			})
			c.Abort()
			return
		}

		if err := validation.ValidateStruct(req); err != nil {
			if valErr, ok := err.(*validation.ValidationError); ok {
				c.JSON(http.StatusBadRequest, gin.H{
					"error":  "Validation failed",
					"fields": valErr.Errors,
				})
			} else {
				c.JSON(http.StatusBadRequest, gin.H{
					"error":   "Validation failed",
					"details": err.Error(),
				})
			}
			c.Abort()
			return
		}

		c.Set("validatedRequest", req)
		c.Next()
	}
}

func ValidateJSON(c *gin.Context, req interface{}) error {
	if err := c.ShouldBindJSON(req); err != nil {
		return err
	}

	return validation.ValidateStruct(req)
}

func ValidateQuery(c *gin.Context, req interface{}) error {
	if err := c.ShouldBindQuery(req); err != nil {
		return err
	}

	return validation.ValidateStruct(req)
}

func ValidateURI(c *gin.Context, req interface{}) error {
	if err := c.ShouldBindUri(req); err != nil {
		return err
	}
	return validation.ValidateStruct(req)
}

func RespondWithValidationError(c *gin.Context, err error) {
	if valErr, ok := err.(*validation.ValidationError); ok {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":  "Validation failed",
			"fields": valErr.Errors,
		})
	} else {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "Validation failed",
			"details": err.Error(),
		})
	}
}

func ValidateAndBind(c *gin.Context, req interface{}) bool {
	if err := ValidateJSON(c, req); err != nil {
		RespondWithValidationError(c, err)
		return false
	}
	return true
}

func ValidateAndBindQuery(c *gin.Context, req interface{}) bool {
	if err := ValidateQuery(c, req); err != nil {
		RespondWithValidationError(c, err)
		return false
	}
	return true
}

func GetValidatedRequest(c *gin.Context) (interface{}, bool) {
	req, exists := c.Get("validatedRequest")
	return req, exists
}

func ValidateContentType(contentType string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.ContentType() != contentType {
			c.JSON(http.StatusUnsupportedMediaType, gin.H{
				"error":    "Unsupported content type",
				"expected": contentType,
				"received": c.ContentType(),
			})
			c.Abort()
			return
		}
		c.Next()
	}
}

func ValidateJSONContentType() gin.HandlerFunc {
	return ValidateContentType("application/json")
}

func MaxBodySize(maxSize int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Body == nil {
			c.Next()
			return
		}

		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxSize)
		bodyBytes, err := io.ReadAll(c.Request.Body)
		if err != nil {
			if err.Error() == "http: request body too large" {
				c.JSON(http.StatusRequestEntityTooLarge, gin.H{
					"error":          "Request body too large",
					"max_size_bytes": maxSize,
				})
				c.Abort()
				return
			}
		}

		c.Request.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))
		c.Next()
	}
}
