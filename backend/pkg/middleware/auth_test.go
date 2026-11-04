package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/models"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type testKeyProvider struct {
	secret []byte
}

func (p testKeyProvider) ResolveKey(string) ([]byte, error) { return p.secret, nil }
func (p testKeyProvider) LegacyKey() []byte                 { return p.secret }

func TestAuthMiddlewareAcceptsOnlyStrictSessionAccessTokens(t *testing.T) {
	gin.SetMode(gin.TestMode)
	secret := []byte("middleware-test-secret")
	provider := testKeyProvider{secret: secret}
	userID := uuid.New()
	sessionID := uuid.New()
	now := time.Now().UTC()
	valid := signedTestToken(t, secret, jwt.SigningMethodHS256, userID, sessionID, AccessTokenIssuer, AccessTokenAudience, now)

	t.Run("valid token sets identity and session", func(t *testing.T) {
		status, capturedUserID, capturedSessionID := runAuthMiddleware(t, provider, valid, "")
		assert.Equal(t, http.StatusNoContent, status)
		assert.Equal(t, userID, capturedUserID)
		assert.Equal(t, sessionID, capturedSessionID)
	})

	t.Run("query token is rejected even with valid header", func(t *testing.T) {
		status, _, _ := runAuthMiddleware(t, provider, valid, "?token=leaked")
		assert.Equal(t, http.StatusUnauthorized, status)
	})

	tests := []struct {
		name   string
		method jwt.SigningMethod
		issuer string
		aud    string
	}{
		{name: "non HS256", method: jwt.SigningMethodHS384, issuer: AccessTokenIssuer, aud: AccessTokenAudience},
		{name: "wrong issuer", method: jwt.SigningMethodHS256, issuer: "other", aud: AccessTokenAudience},
		{name: "wrong audience", method: jwt.SigningMethodHS256, issuer: AccessTokenIssuer, aud: "other"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			raw := signedTestToken(t, secret, test.method, userID, sessionID, test.issuer, test.aud, now)
			status, _, _ := runAuthMiddleware(t, provider, raw, "")
			assert.Equal(t, http.StatusUnauthorized, status)
		})
	}
}

func runAuthMiddleware(t *testing.T, provider testKeyProvider, token, query string) (int, uuid.UUID, uuid.UUID) {
	t.Helper()
	var userID uuid.UUID
	var sessionID uuid.UUID
	router := gin.New()
	router.Use(AuthMiddlewareWithProvider(provider))
	router.GET("/protected", func(c *gin.Context) {
		userID, _ = GetUserID(c)
		sessionID, _ = GetSessionID(c)
		c.Status(http.StatusNoContent)
	})
	req := httptest.NewRequest(http.MethodGet, "/protected"+query, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)
	return recorder.Code, userID, sessionID
}

func signedTestToken(t *testing.T, secret []byte, method jwt.SigningMethod, userID, sessionID uuid.UUID, issuer, audience string, now time.Time) string {
	t.Helper()
	claims := Claims{
		UserID:    userID,
		SessionID: sessionID,
		Email:     "rider@example.com",
		Role:      models.RoleRider,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    issuer,
			Subject:   userID.String(),
			Audience:  jwt.ClaimStrings{audience},
			ExpiresAt: jwt.NewNumericDate(now.Add(15 * time.Minute)),
			IssuedAt:  jwt.NewNumericDate(now),
			ID:        uuid.NewString(),
		},
	}
	token := jwt.NewWithClaims(method, claims)
	token.Header["kid"] = "test"
	signed, err := token.SignedString(secret)
	require.NoError(t, err)
	return signed
}
