package resilience

import (
	"context"

	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	"go.uber.org/zap"
)

// FallbackFunc is executed when the breaker is open or overloaded.
type FallbackFunc func(ctx context.Context, err error) (interface{}, error)

// NoopFallback returns the breaker open error without additional handling.
func NoopFallback(ctx context.Context, err error) (interface{}, error) {
	return nil, ErrCircuitOpen
}

// StaticFallback returns a fixed default value when the circuit is open.
// Use this when a sensible default exists (e.g., empty list, zero value).
func StaticFallback(defaultValue interface{}) FallbackFunc {
	return func(ctx context.Context, err error) (interface{}, error) {
		logger.Warn("circuit breaker open, returning static fallback",
			zap.Error(err),
		)
		return defaultValue, nil
	}
}

// GracefulDegradation returns ErrCircuitOpen but logs a structured warning.
// Use this when the caller handles the error with its own fallback logic.
func GracefulDegradation(serviceName string) FallbackFunc {
	return func(ctx context.Context, err error) (interface{}, error) {
		logger.Warn("circuit breaker open, service degraded",
			zap.String("service", serviceName),
			zap.Error(err),
		)
		return nil, ErrCircuitOpen
	}
}
