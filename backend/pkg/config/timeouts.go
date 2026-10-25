package config

import "time"

const (
	DefaultHTTPClientTimeout          = 30
	DefaultDatabaseQueryTimeout       = 10
	DefaultRedisOperationTimeout      = 5
	DefaultRedisReadTimeout           = 5
	DefaultRedisWriteTimeout          = 5
	DefaultWebSocketConnectionTimeout = 60
	DefaultRequestTimeout             = 30

	MaxHTTPClientTimeout          = 300
	MaxDatabaseQueryTimeout       = 60
	MaxRedisOperationTimeout      = 30
	MaxWebSocketConnectionTimeout = 300
	MaxRequestTimeout             = 300
)

type TimeoutConfig struct {
	HTTPClientTimeout          int
	DatabaseQueryTimeout       int
	RedisOperationTimeout      int
	RedisReadTimeout           int
	RedisWriteTimeout          int
	WebSocketConnectionTimeout int
	DefaultRequestTimeout      int
	RouteOverrides             map[string]int
}

func (t TimeoutConfig) HTTPClientTimeoutDuration() time.Duration {
	return time.Duration(t.HTTPClientTimeout) * time.Second
}
func (t TimeoutConfig) DatabaseQueryTimeoutDuration() time.Duration {
	return time.Duration(t.DatabaseQueryTimeout) * time.Second
}
func (t TimeoutConfig) RedisOperationTimeoutDuration() time.Duration {
	return time.Duration(t.RedisOperationTimeout) * time.Second
}
func (t TimeoutConfig) RedisReadTimeoutDuration() time.Duration {
	if t.RedisReadTimeout > 0 {
		return time.Duration(t.RedisReadTimeout) * time.Second
	}
	return t.RedisOperationTimeoutDuration()
}
func (t TimeoutConfig) RedisWriteTimeoutDuration() time.Duration {
	if t.RedisWriteTimeout > 0 {
		return time.Duration(t.RedisWriteTimeout) * time.Second
	}
	return t.RedisOperationTimeoutDuration()
}
func (t TimeoutConfig) WebSocketConnectionTimeoutDuration() time.Duration {
	return time.Duration(t.WebSocketConnectionTimeout) * time.Second
}
func (t TimeoutConfig) DefaultRequestTimeoutDuration() time.Duration {
	return time.Duration(t.DefaultRequestTimeout) * time.Second
}

func (t TimeoutConfig) DefaultRedisReadTimeoutDuration() time.Duration {
	return time.Duration(t.RedisReadTimeout) * time.Second
}
func (t TimeoutConfig) TimeoutForRoute(method, path string) time.Duration {
	if t.RouteOverrides == nil {
		return t.DefaultRequestTimeoutDuration()
	}
	routeKey := method + ":" + path
	if timeout, ok := t.RouteOverrides[routeKey]; ok && timeout > 0 {
		return time.Duration(timeout) * time.Second
	}
	return t.DefaultRequestTimeoutDuration()
}
