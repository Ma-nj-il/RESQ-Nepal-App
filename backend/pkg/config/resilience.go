package config

type ResilienceConfig struct {
	CircuitBreaker CircuitBreakerConfig
}

type CircuitBreakerConfig struct {
	Enabled          bool
	FailureThreshold int
	SuccessThreshold int
	TimeoutSeconds   int
	IntervalSeconds  int
	ServiceOverrides map[string]CircuitBreakerSettings
}

type CircuitBreakerSettings struct {
	FailureThreshold int `json:"failure_threshold"`
	SuccessThreshold int `json:"success_threshold"`
	TimeoutSeconds   int `json:"timeout_seconds"`
	IntervalSeconds  int `json:"interval_seconds"`
}

func (c CircuitBreakerConfig) SettingsFor(service string) CircuitBreakerSettings {
	settings := CircuitBreakerSettings{
		FailureThreshold: c.FailureThreshold,
		SuccessThreshold: c.SuccessThreshold,
		TimeoutSeconds:   c.TimeoutSeconds,
		IntervalSeconds:  c.IntervalSeconds,
	}

	if c.ServiceOverrides != nil {
		if override, ok := c.ServiceOverrides[service]; ok {
			if override.FailureThreshold > 0 {
				settings.FailureThreshold = override.FailureThreshold
			}
			if override.SuccessThreshold > 0 {
				settings.SuccessThreshold = override.SuccessThreshold
			}
			if override.TimeoutSeconds > 0 {
				settings.TimeoutSeconds = override.TimeoutSeconds
			}
			if override.IntervalSeconds > 0 {
				settings.IntervalSeconds = override.IntervalSeconds
			}
		}
	}

	if settings.SuccessThreshold <= 0 {
		settings.SuccessThreshold = 1
	}
	if settings.FailureThreshold <= 0 {
		settings.FailureThreshold = 5
	}
	if settings.TimeoutSeconds <= 0 {
		settings.TimeoutSeconds = 30
	}
	if settings.IntervalSeconds <= 0 {
		settings.IntervalSeconds = 60
	}

	return settings
}
