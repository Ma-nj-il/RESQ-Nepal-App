package httpclient

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/config"
	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	"github.com/bikky-kc013/medi-ambulance/pkg/middleware"
	"github.com/bikky-kc013/medi-ambulance/pkg/resilience"
	"github.com/google/uuid"
)

type Client struct {
	httpClient  *http.Client
	baseURL     string
	retryConfig *resilience.RetryConfig
}

type Option func(*Client)

func WithRetry(config resilience.RetryConfig) Option {
	return func(c *Client) {
		c.retryConfig = &config
	}
}

func WithDefaultRetry() Option {
	config := resilience.DefaultRetryConfig()
	config.RetryableChecker = isHTTPRetryable
	return func(c *Client) {
		c.retryConfig = &config
	}
}

func NewClient(cfg config.TimeoutConfig, baseURL string, timeout ...time.Duration) *Client {
	timeoutDuration := config.TimeoutConfig.HTTPClientTimeoutDuration(cfg)
	if len(timeout) > 0 && timeout[0] > 0 {
		timeoutDuration = timeout[0]
	}

	transport := &http.Transport{
		DialContext: (&net.Dialer{
			Timeout:   10 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,

		TLSHandshakeTimeout: 10 * time.Second,

		ResponseHeaderTimeout: 10 * time.Second,

		ExpectContinueTimeout: 1 * time.Second,

		MaxIdleConns:        100,
		MaxIdleConnsPerHost: 10,
		MaxConnsPerHost:     100,
		IdleConnTimeout:     90 * time.Second,

		ForceAttemptHTTP2: true,

		TLSClientConfig: &tls.Config{
			MinVersion: tls.VersionTLS12,
		},
	}

	client := &Client{
		httpClient: &http.Client{
			Timeout:   timeoutDuration,
			Transport: transport,
		},
		baseURL: baseURL,
	}

	return client
}

func (c *Client) Post(ctx context.Context, path string, body interface{}, headers map[string]string) ([]byte, error) {
	if c.retryConfig != nil {
		return c.postWithRetry(ctx, path, body, headers)
	}
	return c.doPost(ctx, path, body, headers)
}

func (c *Client) PostWithIdempotency(ctx context.Context, path string, body interface{}, headers map[string]string, idempotencyKey string) ([]byte, error) {
	if headers == nil {
		headers = make(map[string]string)
	}
	if idempotencyKey != "" {
		headers["Idempotency-Key"] = idempotencyKey
	} else {
		headers["Idempotency-Key"] = uuid.New().String()
	}

	return c.Post(ctx, path, body, headers)
}

func (c *Client) postWithRetry(ctx context.Context, path string, body interface{}, headers map[string]string) ([]byte, error) {
	result, err := resilience.Retry(ctx, *c.retryConfig, func(ctx context.Context) (interface{}, error) {
		return c.doPost(ctx, path, body, headers)
	})

	if err != nil {
		return nil, err
	}

	return result.([]byte), nil
}

func (c *Client) doPost(ctx context.Context, path string, body interface{}, headers map[string]string) ([]byte, error) {
	var bodyReader io.Reader
	if body != nil {
		jsonData, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal request body: %w", err)
		}
		bodyReader = bytes.NewBuffer(jsonData)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	injectCorrelationID(ctx, req)
	for key, value := range headers {
		req.Header.Set(key, value)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to make request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	if resp.StatusCode >= 400 {
		return nil, &HTTPError{
			StatusCode: resp.StatusCode,
			Body:       string(respBody),
		}
	}

	return respBody, nil
}

func (c *Client) Get(ctx context.Context, path string, headers map[string]string) ([]byte, error) {
	if c.retryConfig != nil {
		return c.getWithRetry(ctx, path, headers)
	}
	return c.doGet(ctx, path, headers)
}

func (c *Client) getWithRetry(ctx context.Context, path string, headers map[string]string) ([]byte, error) {
	result, err := resilience.Retry(ctx, *c.retryConfig, func(ctx context.Context) (interface{}, error) {
		return c.doGet(ctx, path, headers)
	})

	if err != nil {
		return nil, err
	}

	return result.([]byte), nil
}

func (c *Client) doGet(ctx context.Context, path string, headers map[string]string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	injectCorrelationID(ctx, req)
	for key, value := range headers {
		req.Header.Set(key, value)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to make request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	if resp.StatusCode >= 400 {
		return nil, &HTTPError{
			StatusCode: resp.StatusCode,
			Body:       string(respBody),
		}
	}

	return respBody, nil
}

type HTTPError struct {
	StatusCode int
	Body       string
}

func (e *HTTPError) Error() string {
	return fmt.Sprintf("HTTP %d: %s", e.StatusCode, e.Body)
}

func isHTTPRetryable(err error) bool {
	if err == nil {
		return false
	}

	if httpErr, ok := err.(*HTTPError); ok {
		return resilience.IsRetryableHTTPStatus(httpErr.StatusCode)
	}

	return true
}

func injectCorrelationID(ctx context.Context, req *http.Request) {
	if ctx == nil || req == nil {
		return
	}

	if correlationID := logger.CorrelationIDFromContext(ctx); correlationID != "" {
		req.Header.Set(middleware.CorrelationIDHeader, correlationID)
	}
}
