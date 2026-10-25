package health

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
)

type Checker func() error

type CheckerConfig struct {
	Timeout time.Duration
}

func DefaultCheckerConfig() CheckerConfig {
	return CheckerConfig{
		Timeout: 2 * time.Second,
	}
}

func DatabaseChecker(db *sql.DB) Checker {
	return DatabaseCheckerWithConfig(db, DefaultCheckerConfig())
}

func DatabaseCheckerWithConfig(db *sql.DB, cfg CheckerConfig) Checker {
	return func() error {
		if db == nil {
			return fmt.Errorf("database connection is nil")
		}

		ctx, cancel := context.WithTimeout(context.Background(), cfg.Timeout)
		defer cancel()

		if err := db.PingContext(ctx); err != nil {
			return fmt.Errorf("database ping failed: %w", err)
		}

		stats := db.Stats()
		if stats.OpenConnections == 0 {
			return fmt.Errorf("no open database connections")
		}

		return nil
	}
}

func RedisChecker(client *redis.Client) Checker {
	return RedisCheckerWithConfig(client, DefaultCheckerConfig())
}

func RedisCheckerWithConfig(client *redis.Client, cfg CheckerConfig) Checker {
	return func() error {
		ctx, cancel := context.WithTimeout(context.Background(), cfg.Timeout)
		defer cancel()

		if err := client.Ping(ctx).Err(); err != nil {
			return fmt.Errorf("redis ping failed: %w", err)
		}

		return nil
	}
}

func HTTPEndpointChecker(url string) Checker {
	return HTTPEndpointCheckerWithConfig(url, DefaultCheckerConfig())
}

func HTTPEndpointCheckerWithConfig(url string, cfg CheckerConfig) Checker {
	client := &http.Client{
		Timeout: cfg.Timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	return func() error {
		ctx, cancel := context.WithTimeout(context.Background(), cfg.Timeout)
		defer cancel()

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return fmt.Errorf("failed to create request: %w", err)
		}

		resp, err := client.Do(req)
		if err != nil {
			return fmt.Errorf("http request failed: %w", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode >= 400 {
			return fmt.Errorf("unhealthy status code: %d", resp.StatusCode)
		}

		return nil
	}
}

func GRPCEndpointChecker(target string) Checker {
	return func() error {

		return nil
	}
}

func CompositeChecker(name string, checkers map[string]Checker) Checker {
	return func() error {
		for checkName, checker := range checkers {
			if err := checker(); err != nil {
				return fmt.Errorf("%s.%s check failed: %w", name, checkName, err)
			}
		}
		return nil
	}
}

func AsyncChecker(checker Checker, timeout time.Duration) Checker {
	return func() error {
		errChan := make(chan error, 1)
		go func() {
			errChan <- checker()
		}()

		select {
		case err := <-errChan:
			return err
		case <-time.After(timeout):
			return fmt.Errorf("health check timeout after %v", timeout)
		}
	}
}

type CachedChecker struct {
	checker    Checker
	cacheTTL   time.Duration
	lastCheck  time.Time
	lastResult error
}

func NewCachedChecker(checker Checker, cacheTTL time.Duration) *CachedChecker {
	return &CachedChecker{
		checker:  checker,
		cacheTTL: cacheTTL,
	}
}

func (c *CachedChecker) Check() error {
	now := time.Now()
	if now.Sub(c.lastCheck) < c.cacheTTL {
		return c.lastResult
	}

	c.lastResult = c.checker()
	c.lastCheck = now
	return c.lastResult
}
