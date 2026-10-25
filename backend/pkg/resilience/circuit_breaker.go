package resilience

import (
	"context"
	"errors"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	"github.com/sony/gobreaker"
	"go.uber.org/zap"
)

var ErrCircuitOpen = errors.New("circuit breaker open")

type Operation func(ctx context.Context) (interface{}, error)

type Settings struct {
	Name             string
	Interval         time.Duration
	Timeout          time.Duration
	FailureThreshold uint32
	SuccessThreshold uint32
}

type CircuitBreaker struct {
	breaker  *gobreaker.CircuitBreaker
	fallback FallbackFunc
	name     string
}

func NewCircuitBreaker(settings Settings, fallback FallbackFunc) *CircuitBreaker {
	name := nextBreakerName(settings.Name)

	readyToTrip := func(counts gobreaker.Counts) bool {
		threshold := settings.FailureThreshold
		if threshold == 0 {
			threshold = 5
		}
		return counts.ConsecutiveFailures >= threshold
	}

	breakerSettings := gobreaker.Settings{
		Name:        name,
		Timeout:     settings.Timeout,
		Interval:    settings.Interval,
		ReadyToTrip: readyToTrip,
		OnStateChange: func(name string, from, to gobreaker.State) {
			logger.Get().Info("circuit breaker state change",
				zap.String("breaker", name),
				zap.String("from", from.String()),
				zap.String("to", to.String()),
			)
			recordBreakerStateChange(name, from, to)
		},
	}

	if settings.SuccessThreshold > 0 {
		breakerSettings.MaxRequests = settings.SuccessThreshold
	}

	cb := &CircuitBreaker{
		breaker:  gobreaker.NewCircuitBreaker(breakerSettings),
		fallback: fallback,
		name:     name,
	}

	recordBreakerState(name, gobreaker.StateClosed)
	return cb
}

func (c *CircuitBreaker) Execute(ctx context.Context, operation Operation) (interface{}, error) {
	if operation == nil {
		return nil, errors.New("operation cannot be nil")
	}

	if c == nil || c.breaker == nil {
		return operation(ctx)
	}

	recordBreakerRequest(c.name)

	result, err := c.breaker.Execute(func() (interface{}, error) {
		return operation(ctx)
	})
	if err == nil {
		return result, nil
	}

	if errors.Is(err, gobreaker.ErrOpenState) || errors.Is(err, gobreaker.ErrTooManyRequests) {
		recordBreakerFallback(c.name)
		if c.fallback != nil {
			return c.fallback(ctx, err)
		}
		return nil, ErrCircuitOpen
	}

	recordBreakerFailure(c.name)
	return nil, err
}

// Allow reports whether the breaker would allow a request without executing it.
func (c *CircuitBreaker) Allow() bool {
	if c == nil || c.breaker == nil {
		return true
	}
	return c.breaker.State() != gobreaker.StateOpen
}
