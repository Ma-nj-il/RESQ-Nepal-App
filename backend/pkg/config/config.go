package config

import (
	"os"
	"strconv"

	"github.com/bikky-kc013/medi-ambulance/pkg/secrets"
	"github.com/joho/godotenv"
)

type Config struct {
	Server        ServerConfig
	Database      DatabaseConfig
	Redis         RedisConfig
	JWT           JWTConfig
	PubSub        PubSubConfig
	Firebase      FirebaseConfig
	Business      BusinessConfig
	Notifications NotificationsConfig
	RateLimit     RateLimitConfig
	NATS          NATSConfig
	Resilience    ResilienceConfig
	Timeout       TimeoutConfig
	Secrets       SecretsSettings
	Maps          MapsConfig
	Checkr        CheckrConfig
	Onfido        OnfidoConfig
}

func Load(serviceName string) (*Config, error) {
	_ = godotenv.Load()

	cfg := &Config{
		Server: ServerConfig{
			Port:         getEnv("PORT", "8080"),
			Environment:  getEnv("ENVIRONMENT", "development"),
			ServiceName:  serviceName,
			ReadTimeout:  getEnvAsInt("READ_TIMEOUT", 10),
			WriteTimeout: getEnvAsInt("WRITE_TIMEOUT", 10),
			CORSOrigins:  getEnv("CORS_ORIGINS", "http://localhost:3000"),
		},
		Database: DatabaseConfig{
			Host:        getEnv("DB_HOST", "localhost"),
			Port:        getEnv("DB_PORT", "5432"),
			User:        getEnv("DB_USER", "postgres"),
			Password:    getEnv("DB_PASSWORD", "postgres"),
			DBName:      getEnv("DB_NAME", "ridehailing"),
			SSLMode:     getEnv("DB_SSLMODE", "disable"),
			MaxConns:    getEnvAsInt("DB_MAX_CONNS", 25),
			MinConns:    getEnvAsInt("DB_MIN_CONNS", 5),
			ServiceName: serviceName,
			Breaker: DatabaseBreakerConfig{
				Enabled:          getEnvAsBool("DB_BREAKER_ENABLED", false),
				FailureThreshold: getEnvAsInt("DB_BREAKER_FAILURE_THRESHOLD", 5),
				SuccessThreshold: getEnvAsInt("DB_BREAKER_SUCCESS_THRESHOLD", 1),
				TimeoutSeconds:   getEnvAsInt("DB_BREAKER_TIMEOUT_SECONDS", 30),
				IntervalSeconds:  getEnvAsInt("DB_BREAKER_INTERVAL_SECONDS", 60),
			},
		},
		Redis: RedisConfig{
			Host:     getEnv("REDIS_HOST", "localhost"),
			Port:     getEnv("REDIS_PORT", "6379"),
			Password: getEnv("REDIS_PASSWORD", ""),
			DB:       getEnvAsInt("REDIS_DB", 0),
		},
		JWT: JWTConfig{
			Secret:         getEnv("JWT_SECRET", ""),
			Expiration:     getEnvAsInt("JWT_EXPIRATION", 24),
			KeyFile:        getEnv("JWT_KEYS_FILE", "config/jwt_keys.json"),
			RotationHours:  getEnvAsInt("JWT_ROTATION_HOURS", 24*30),
			GraceHours:     getEnvAsInt("JWT_ROTATION_GRACE_HOURS", 24*30),
			RefreshMinutes: getEnvAsInt("JWT_KEY_REFRESH_MINUTES", 5),
		},
		PubSub: PubSubConfig{
			ProjectID: getEnv("PUBSUB_PROJECT_ID", ""),
			Enabled:   getEnvAsBool("PUBSUB_ENABLED", false),
		},
		NATS: NATSConfig{
			URL:        getEnv("NATS_URL", "nats://localhost:4222"),
			StreamName: getEnv("NATS_STREAM_NAME", "RIDEHAILING"),
			Enabled:    getEnvAsBool("NATS_ENABLED", false),
		},
		Firebase: FirebaseConfig{
			ProjectID:       getEnv("FIREBASE_PROJECT_ID", ""),
			CredentialsPath: getEnv("FIREBASE_CREDENTIALS_PATH", ""),
			CredentialsJSON: getEnv("FIREBASE_CREDENTIALS_JSON", ""),
			Enabled:         getEnvAsBool("FIREBASE_ENABLED", false),
		},
		Business: BusinessConfig{
			CommissionRate:      getEnvAsFloat("COMMISSION_RATE", 0.20),
			CancellationFeeRate: getEnvAsFloat("CANCELLATION_FEE_RATE", 0.10),
		},
		Notifications: NotificationsConfig{
			TwilioAccountSID: getEnv("TWILIO_ACCOUNT_SID", ""),
			TwilioAuthToken:  getEnv("TWILIO_AUTH_TOKEN", ""),
			TwilioFromNumber: getEnv("TWILIO_FROM_NUMBER", ""),
			SMTPHost:         getEnv("SMTP_HOST", ""),
			SMTPPort:         getEnv("SMTP_PORT", ""),
			SMTPUsername:     getEnv("SMTP_USERNAME", ""),
			SMTPPassword:     getEnv("SMTP_PASSWORD", ""),
			SMTPFromEmail:    getEnv("SMTP_FROM_EMAIL", ""),
			SMTPFromName:     getEnv("SMTP_FROM_NAME", ""),
		},
		RateLimit: RateLimitConfig{
			Enabled:        getEnvAsBool("RATE_LIMIT_ENABLED", false),
			WindowSeconds:  getEnvAsInt("RATE_LIMIT_WINDOW_SECONDS", 60),
			DefaultLimit:   getEnvAsInt("RATE_LIMIT_DEFAULT_LIMIT", 120),
			DefaultBurst:   getEnvAsInt("RATE_LIMIT_DEFAULT_BURST", 40),
			AnonymousLimit: getEnvAsInt("RATE_LIMIT_ANON_LIMIT", 60),
			AnonymousBurst: getEnvAsInt("RATE_LIMIT_ANON_BURST", 20),
			RedisPrefix:    getEnv("RATE_LIMIT_REDIS_PREFIX", "rate-limit"),
			EndpointOverrides: map[string]EndpointRateLimitConfig{
				"POST:/api/v1/auth/login":       {AuthenticatedLimit: 10, AuthenticatedBurst: 3, AnonymousLimit: 5, AnonymousBurst: 2, WindowSeconds: 60},
				"POST:/api/v1/auth/register":    {AuthenticatedLimit: 5, AuthenticatedBurst: 2, AnonymousLimit: 3, AnonymousBurst: 1, WindowSeconds: 60},
				"POST:/api/v1/payments/process": {AuthenticatedLimit: 30, AuthenticatedBurst: 5, AnonymousLimit: 0, AnonymousBurst: 0, WindowSeconds: 60},
				"POST:/api/v1/geo/location":     {AuthenticatedLimit: 600, AuthenticatedBurst: 100, AnonymousLimit: 0, AnonymousBurst: 0, WindowSeconds: 60},
			},
		},
		Resilience: ResilienceConfig{
			CircuitBreaker: CircuitBreakerConfig{
				Enabled:          getEnvAsBool("CB_ENABLED", false),
				FailureThreshold: getEnvAsInt("CB_FAILURE_THRESHOLD", 5),
				SuccessThreshold: getEnvAsInt("CB_SUCCESS_THRESHOLD", 1),
				TimeoutSeconds:   getEnvAsInt("CB_TIMEOUT_SECONDS", 30),
				IntervalSeconds:  getEnvAsInt("CB_INTERVAL_SECONDS", 60),
			},
		},
		Timeout: TimeoutConfig{
			HTTPClientTimeout:          getEnvAsInt("HTTP_CLIENT_TIMEOUT", DefaultHTTPClientTimeout),
			DatabaseQueryTimeout:       getEnvAsInt("DB_QUERY_TIMEOUT", DefaultDatabaseQueryTimeout),
			RedisOperationTimeout:      getEnvAsInt("REDIS_OPERATION_TIMEOUT", DefaultRedisOperationTimeout),
			RedisReadTimeout:           getEnvAsInt("REDIS_READ_TIMEOUT", DefaultRedisReadTimeout),
			RedisWriteTimeout:          getEnvAsInt("REDIS_WRITE_TIMEOUT", DefaultRedisWriteTimeout),
			WebSocketConnectionTimeout: getEnvAsInt("WS_CONNECTION_TIMEOUT", DefaultWebSocketConnectionTimeout),
			DefaultRequestTimeout:      getEnvAsInt("DEFAULT_REQUEST_TIMEOUT", DefaultRequestTimeout),
			RouteOverrides:             make(map[string]int),
		},
		Maps: MapsConfig{
			Enabled:             getEnvAsBool("MAPS_ENABLED", false),
			PrimaryProvider:     getEnv("MAPS_PRIMARY_PROVIDER", "google"),
			GoogleAPIKey:        getEnv("GOOGLE_MAPS_API_KEY", ""),
			HEREAPIKey:          getEnv("HERE_API_KEY", ""),
			CacheEnabled:        getEnvAsBool("MAPS_CACHE_ENABLED", true),
			CacheTTLSeconds:     getEnvAsInt("MAPS_CACHE_TTL_SECONDS", 300),
			TrafficEnabled:      getEnvAsBool("MAPS_TRAFFIC_ENABLED", true),
			TrafficRefreshSecs:  getEnvAsInt("MAPS_TRAFFIC_REFRESH_SECONDS", 60),
			FallbackToHaversine: getEnvAsBool("MAPS_FALLBACK_HAVERSINE", true),
		},
		Checkr: CheckrConfig{
			APIKey:     getEnv("CHECKR_API_KEY", ""),
			WebhookKey: getEnv("CHECKR_WEBHOOK_KEY", ""),
			Package:    getEnv("CHECKR_PACKAGE", "driver_standard"),
			Enabled:    getEnvAsBool("CHECKR_ENABLED", false),
		},
		Onfido: OnfidoConfig{
			APIKey:     getEnv("ONFIDO_API_KEY", ""),
			WebhookKey: getEnv("ONFIDO_WEBHOOK_KEY", ""),
			WorkflowID: getEnv("ONFIDO_WORKFLOW_ID", ""),
			Enabled:    getEnvAsBool("ONFIDO_ENABLED", false),
		},
		Secrets: SecretsSettings{
			Provider:        secrets.ProviderType(getEnv("SECRETS_PROVIDER", "")),
			CacheTTLSeconds: getEnvAsInt("SECRETS_CACHE_TTL_SECONDS", 300),
			RotationDays:    getEnvAsInt("SECRETS_ROTATION_DAYS", 90),
			AuditEnabled:    getEnvAsBool("SECRETS_AUDIT_ENABLED", true),
			AWS: secrets.AWSConfig{
				Region:          getEnv("SECRETS_AWS_REGION", ""),
				AccessKeyID:     getEnv("SECRETS_AWS_ACCESS_KEY_ID", ""),
				SecretAccessKey: getEnv("SECRETS_AWS_SECRET_ACCESS_KEY", ""),
				SessionToken:    getEnv("SECRETS_AWS_SESSION_TOKEN", ""),
				Profile:         getEnv("SECRETS_AWS_PROFILE", ""),
				Endpoint:        getEnv("SECRETS_AWS_ENDPOINT", ""),
			},
			GCP: secrets.GCPConfig{
				ProjectID:       getEnv("SECRETS_GCP_PROJECT_ID", ""),
				CredentialsJSON: getEnv("SECRETS_GCP_CREDENTIALS_JSON", ""),
				CredentialsFile: getEnv("SECRETS_GCP_CREDENTIALS_FILE", ""),
			},
			Kubernetes: secrets.KubernetesConfig{
				BasePath: getEnv("SECRETS_K8S_BASE_PATH", "/var/run/secrets/ride-hailing"),
			},
		},
	}
	if err := cfg.populateSecretReferences(); err != nil {
		return nil, err
	}
	if err := cfg.initializeSecrets(); err != nil {
		return nil, err
	}

	return cfg, nil
}

func (c *Config) Close() error {
	if c == nil || c.Secrets.manager == nil {
		return nil
	}
	return c.Secrets.manager.Close()
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvAsInt(key string, defaultValue int) int {
	valueStr := getEnv(key, "")
	if value, err := strconv.Atoi(valueStr); err == nil {
		return value
	}
	return defaultValue
}

func getEnvAsBool(key string, defaultValue bool) bool {
	valueStr := getEnv(key, "")
	if value, err := strconv.ParseBool(valueStr); err == nil {
		return value
	}
	return defaultValue
}

func getEnvAsFloat(key string, defaultValue float64) float64 {
	valueStr := getEnv(key, "")
	if value, err := strconv.ParseFloat(valueStr, 64); err == nil {
		return value
	}
	return defaultValue
}
