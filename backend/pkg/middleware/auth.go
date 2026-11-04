package middleware

import (
	"errors"
	"net/http"
	"strings"

	"github.com/bikky-kc013/medi-ambulance/pkg/common"
	"github.com/bikky-kc013/medi-ambulance/pkg/jwtkeys"
	"github.com/bikky-kc013/medi-ambulance/pkg/models"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

type Claims struct {
	UserID    uuid.UUID       `json:"user_id"`
	SessionID uuid.UUID       `json:"sid"`
	Email     string          `json:"email"`
	Role      models.UserRole `json:"role"`
	jwt.RegisteredClaims
}

const (
	AccessTokenIssuer   = "resq-auth"
	AccessTokenAudience = "resq-api"
)

func AuthMiddlewareWithProvider(provider jwtkeys.KeyProvider) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.URL.Query().Has("token") {
			common.AppErrorResponse(c, common.NewErrorWithCode(
				http.StatusUnauthorized,
				common.ErrCodeInvalidToken,
				"query-string bearer tokens are not accepted",
				common.ErrInvalidToken,
			))
			c.Abort()
			return
		}

		authHeader := c.GetHeader("Authorization")
		parts := strings.Fields(authHeader)
		if len(parts) != 2 || parts[0] != "Bearer" || parts[1] == "" {
			common.AppErrorResponse(c, common.NewErrorWithCode(
				http.StatusUnauthorized,
				common.ErrCodeUnauthorized,
				"authorization requires a Bearer token",
				common.ErrUnauthorized,
			))
			c.Abort()
			return
		}
		tokenString := parts[1]

		token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
			return resolveSigningKey(provider, token)
		},
			jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
			jwt.WithIssuer(AccessTokenIssuer),
			jwt.WithAudience(AccessTokenAudience),
			jwt.WithExpirationRequired(),
		)

		if err != nil || !token.Valid {
			common.AppErrorResponse(c, common.NewErrorWithCode(
				http.StatusUnauthorized,
				common.ErrCodeInvalidToken,
				"invalid or expired token",
				common.ErrInvalidToken,
			))
			c.Abort()
			return
		}

		claims, ok := token.Claims.(*Claims)
		if !ok || claims.UserID == uuid.Nil || claims.SessionID == uuid.Nil || claims.ID == "" || claims.Subject != claims.UserID.String() {
			common.AppErrorResponse(c, common.NewErrorWithCode(
				http.StatusUnauthorized,
				common.ErrCodeInvalidToken,
				"invalid token claims",
				common.ErrInvalidToken,
			))
			c.Abort()
			return
		}

		c.Set("user_id", claims.UserID)
		c.Set("user_email", claims.Email)
		c.Set("user_role", claims.Role)
		c.Set("session_id", claims.SessionID)
		c.Set("token_id", claims.ID)

		c.Next()
	}
}

func resolveSigningKey(provider jwtkeys.KeyProvider, token *jwt.Token) ([]byte, error) {
	if token.Method != jwt.SigningMethodHS256 {
		return nil, errors.New("unexpected JWT signing method")
	}
	if provider == nil {
		return nil, errors.New("jwt provider is nil")
	}
	var kid string
	if headerKid, ok := token.Header["kid"]; ok {
		kid, _ = headerKid.(string)
	}
	if kid != "" {
		return provider.ResolveKey(kid)
	}

	legacy := provider.LegacyKey()

	if len(legacy) == 0 {
		return nil, jwtkeys.ErrKeyNotFound
	}
	return legacy, nil
}

func GetSessionID(c *gin.Context) (uuid.UUID, error) {
	sessionID, exists := c.Get("session_id")
	if !exists {
		return uuid.Nil, common.ErrUnauthorized
	}
	id, ok := sessionID.(uuid.UUID)
	if !ok || id == uuid.Nil {
		return uuid.Nil, common.ErrUnauthorized
	}
	return id, nil
}

func RequireRole(roles ...models.UserRole) gin.HandlerFunc {
	return func(c *gin.Context) {
		userRole, exists := c.Get("user_role")
		if !exists {
			common.ErrorResponse(c, http.StatusUnauthorized, "user role not found")
			c.Abort()
			return
		}

		role := userRole.(models.UserRole)

		hasRole := false
		for _, requiredRole := range roles {
			if role == requiredRole {
				hasRole = true
				break
			}
		}

		if !hasRole {
			common.ErrorResponse(c, http.StatusForbidden, "insufficient permissions")
			c.Abort()
			return
		}

		c.Next()
	}
}

func GetUserID(c *gin.Context) (uuid.UUID, error) {
	userID, exists := c.Get("user_id")
	if !exists {
		return uuid.Nil, common.ErrUnauthorized
	}

	id, ok := userID.(uuid.UUID)
	if !ok {
		return uuid.Nil, common.ErrUnauthorized
	}

	return id, nil
}

func GetUserRole(c *gin.Context) (models.UserRole, error) {
	role, exists := c.Get("user_role")
	if !exists {
		return "", common.ErrUnauthorized
	}
	return role.(models.UserRole), nil
}
