package middleware

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestSanitizePayloadRedactsAuthSecrets(t *testing.T) {
	payload := []byte(`{
		"email":"rider@example.com",
		"password":"password1",
		"current_password":"password1",
		"data":{
			"access_token":"access-secret",
			"refresh_token":"refresh-secret",
			"recovery_codes":["CODE-ONE"]
		},
		"first_name":"Asha"
	}`)

	sanitized := sanitizePayload(payload)
	for _, secret := range []string{"rider@example.com", "password1", "access-secret", "refresh-secret", "CODE-ONE"} {
		assert.NotContains(t, sanitized, secret)
	}
	assert.Contains(t, sanitized, "[REDACTED]")
	assert.Contains(t, sanitized, "Asha")
}

func TestSanitizeQueryRedactsBearerMaterial(t *testing.T) {
	sanitized := sanitizeQuery("token=raw-secret&email=rider%40example.com&limit=20")
	assert.NotContains(t, sanitized, "raw-secret")
	assert.NotContains(t, sanitized, "rider%40example.com")
	assert.Contains(t, sanitized, "limit=20")
	assert.Equal(t, 2, strings.Count(sanitized, "%5BREDACTED%5D"))
}
