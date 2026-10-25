package config

import "time"

type RateLimitConfig struct {
	Enabled           bool
	WindowSeconds     int
	DefaultLimit      int
	DefaultBurst      int
	AnonymousLimit    int
	AnonymousBurst    int
	RedisPrefix       string
	EndpointOverrides map[string]EndpointRateLimitConfig
}

type EndpointRateLimitConfig struct {
	AuthenticatedLimit int `json:"authenticated_limit"`
	AuthenticatedBurst int `json:"authenticated_burst"`
	AnonymousLimit     int `json:"anonymous_limit"`
	AnonymousBurst     int `json:"anonymous_burst"`
	WindowSeconds      int `json:"window_seconds"`
}

func (c RateLimitConfig) Window() time.Duration {
	if c.WindowSeconds <= 0 {
		return time.Minute
	}
	return time.Duration(c.WindowSeconds) * time.Second
}
