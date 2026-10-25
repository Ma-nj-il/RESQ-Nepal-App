package websocket

import (
	"net/http"
	"strings"

	"github.com/bikky-kc013/medi-ambulance/pkg/jwtkeys"
	"github.com/bikky-kc013/medi-ambulance/pkg/models"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"go.uber.org/zap"
)

type Claims struct {
	UserID uuid.UUID       `json:"user_id"`
	Email  string          `json:"email"`
	Role   models.UserRole `json:"role"`
	jwt.RegisteredClaims
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

func HandleWebSocket(c *gin.Context, hub *Hub, jwtProvider jwtkeys.KeyProvider) {
	tokenString := c.Query("token")
	if tokenString == "" {
		authHeader := c.GetHeader("Authorization")
		if authHeader != "" {
			parts := strings.Split(authHeader, " ")
			if len(parts) == 2 && parts[0] == "Bearer" {
				tokenString = parts[1]
			}
		}
	}

	if tokenString == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authorization required"})
		return
	}

	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		return resolveSigningKey(jwtProvider, token)
	})

	if err != nil || !token.Valid {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired token"})
		return
	}

	claims, ok := token.Claims.(*Claims)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token claims"})
		return
	}

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		zap.L().Error("failed to upgrade WebSocket", zap.Error(err))
		return
	}

	role := "rider"
	if claims.Role == models.RoleDriver {
		role = "driver"
	}

	client := NewClient(claims.UserID.String(), conn, hub, role, zap.L())

	hub.Register <- client

	go client.WritePump()
	go client.ReadPump()
}

func resolveSigningKey(provider jwtkeys.KeyProvider, token *jwt.Token) ([]byte, error) {
	if provider == nil {
		return nil, jwt.ErrInvalidKey
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
