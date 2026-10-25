package resilience

import "time"

// BuildSettings produces a Settings struct from primitive tuning knobs.
func BuildSettings(name string, intervalSeconds, timeoutSeconds, failureThreshold, successThreshold int) Settings {
	interval := time.Duration(intervalSeconds) * time.Second
	if interval <= 0 {
		interval = time.Minute
	}

	timeout := time.Duration(timeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 30 * time.Second
	}

	if failureThreshold <= 0 {
		failureThreshold = 5
	}

	if successThreshold <= 0 {
		successThreshold = 1
	}

	return Settings{
		Name:             name,
		Interval:         interval,
		Timeout:          timeout,
		FailureThreshold: uint32(failureThreshold),
		SuccessThreshold: uint32(successThreshold),
	}
}
