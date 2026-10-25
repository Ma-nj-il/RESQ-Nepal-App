package jwtkeys

import (
	"crypto/rand"
	"fmt"
	"time"
)

func generateKeyID(now time.Time) string {
	return fmt.Sprintf("kid_%d", now.UnixNano())
}

func generateSecret() ([]byte, error) {
	buf := make([]byte, 48)
	if _, err := rand.Read(buf); err != nil {
		return nil, err
	}
	return buf, nil
}
