package jwtkeys

import (
	"encoding/base64"
	"time"
)

type Config struct {
	KeyFilePath      string
	RotationInterval time.Duration
	GracePeriod      time.Duration
	LegacySecret     string
	ReadOnly         bool
	Store            Store
}

type SigningKey struct {
	ID        string    `json:"id"`
	Secret    string    `json:"secret"`
	CreatedAt time.Time `json:"created_at"`
	ExpiresAt time.Time `json:"expires_at"`
	Revoked   bool      `json:"revoked"`
}

func (k *SigningKey) SecretBytes() ([]byte, error) {
	return base64.StdEncoding.DecodeString(k.Secret)
}

func (k *SigningKey) Clone() *SigningKey {
	if k == nil {
		return nil
	}
	copy := *k
	return &copy
}
