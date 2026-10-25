package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/bikky-kc013/medi-ambulance/internal/pricing"
	"github.com/bikky-kc013/medi-ambulance/internal/rides"
	"github.com/bikky-kc013/medi-ambulance/pkg/common"
	"github.com/bikky-kc013/medi-ambulance/pkg/config"
	"github.com/bikky-kc013/medi-ambulance/pkg/database"
	"github.com/bikky-kc013/medi-ambulance/pkg/eventbus"
	"github.com/bikky-kc013/medi-ambulance/pkg/httpclient"
	"github.com/bikky-kc013/medi-ambulance/pkg/jwtkeys"
	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	"github.com/bikky-kc013/medi-ambulance/pkg/middleware"
	"github.com/bikky-kc013/medi-ambulance/pkg/ratelimit"
	redisclient "github.com/bikky-kc013/medi-ambulance/pkg/redis"
	"github.com/bikky-kc013/medi-ambulance/pkg/resilience"
	"github.com/bikky-kc013/medi-ambulance/pkg/tracing"
	"go.uber.org/zap"
)

const (
	serviceName = "rides-service"
	version     = "1.0.0"
)

func main() {
	if os.Getenv("PORT") == "" {
		os.Setenv("PORT", "8082")
	}
	cfg, err := config.Load(serviceName)
	if err != nil {
		panic(fmt.Sprintf("failed to load config: %v", err))
	}
	defer cfg.Close()

	rootCtx, cancelKeys := context.WithCancel(context.Background())
	defer cancelKeys()

	if err := logger.Init(cfg.Server.Environment); err != nil {
		panic(fmt.Sprintf("failed to initialize logger: %v", err))
	}
	defer logger.Sync()

	logger.Info("Starting rides service",
		zap.String("service", serviceName),
		zap.String("version", version),
		zap.String("environment", cfg.Server.Environment),
	)

	tracerEnabled := os.Getenv("OTEL_ENABLED") == "true"
	if tracerEnabled {
		tracerCfg := tracing.Config{
			ServiceName:    os.Getenv("OTEL_SERVICE_NAME"),
			ServiceVersion: os.Getenv("OTEL_SERVICE_VERSION"),
			Environment:    cfg.Server.Environment,
			OTLPEndpoint:   os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT"),
			Enabled:        true,
		}

		tp, err := tracing.InitTracer(tracerCfg, logger.Get())
		if err != nil {
			logger.Warn("Failed to initialize tracer, continuing without tracing", zap.Error(err))
		} else {
			defer func() {
				shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				if err := tp.Shutdown(shutdownCtx); err != nil {
					logger.Warn("Failed to shutdown tracer", zap.Error(err))
				}
			}()
			logger.Info("OpenTelemetry tracing initialized successfully")
		}
	}

	db, err := database.NewDBPool(&cfg.Database, nil, cfg.Timeout.DatabaseQueryTimeout)
	if err != nil {
		logger.Fatal("Failed to connect to database", zap.Error(err))
	}
	defer db.Close()
	logger.Info("Connected to database")

	var (
		redisClient   *redisclient.Client
		limiter       *ratelimit.Limiter
		promosBreaker *resilience.CircuitBreaker
		mlEtaClient   *httpclient.Client
		mlEtaBreaker  *resilience.CircuitBreaker
	)

	redisClient, err = redisclient.NewRedisClient(&cfg.Redis)
	if err != nil {
		logger.Warn("Failed to initialize Redis - idempotency and rate limiting disabled", zap.Error(err))
	} else {
		defer func() {
			if err := redisClient.Close(); err != nil {
				logger.Warn("Failed to close redis client", zap.Error(err))
			}
		}()

		if cfg.RateLimit.Enabled {
			limiter = ratelimit.NewLimiter(redisClient.Client, cfg.RateLimit)
			logger.Info("Rate limiting enabled",
				zap.Int("default_limit", cfg.RateLimit.DefaultLimit),
				zap.Int("default_burst", cfg.RateLimit.DefaultBurst),
				zap.Duration("window", cfg.RateLimit.Window()),
			)
		}
	}

	promosServiceURL := os.Getenv("PROMOS_SERVICE_URL")
	if promosServiceURL == "" {
		promosServiceURL = "http://localhost:8089"
	}
	logger.Info("Promos service URL configured", zap.String("url", promosServiceURL))

	if cfg.Resilience.CircuitBreaker.Enabled {
		breakerCfg := cfg.Resilience.CircuitBreaker.SettingsFor("promos-service")
		promosBreaker = resilience.NewCircuitBreaker(resilience.Settings{
			Name:             "promos-service",
			Interval:         time.Duration(breakerCfg.IntervalSeconds) * time.Second,
			Timeout:          time.Duration(breakerCfg.TimeoutSeconds) * time.Second,
			FailureThreshold: uint32(breakerCfg.FailureThreshold),
			SuccessThreshold: uint32(breakerCfg.SuccessThreshold),
		}, resilience.GracefulDegradation("promos-service"))

		logger.Info("Circuit breaker configured for promos service",
			zap.Int("failure_threshold", breakerCfg.FailureThreshold),
			zap.Int("success_threshold", breakerCfg.SuccessThreshold),
			zap.Int("timeout_seconds", breakerCfg.TimeoutSeconds),
			zap.Int("interval_seconds", breakerCfg.IntervalSeconds),
		)
	}

	mlEtaURL := os.Getenv("ML_ETA_SERVICE_URL")
	if mlEtaURL != "" {
		mlEtaClient = httpclient.NewClient(cfg.Timeout, mlEtaURL)
		if cfg.Resilience.CircuitBreaker.Enabled {
			cbCfg := cfg.Resilience.CircuitBreaker.SettingsFor("ml-eta-service")
			mlEtaBreaker = resilience.NewCircuitBreaker(
				resilience.BuildSettings("ml-eta-service", cbCfg.IntervalSeconds, cbCfg.TimeoutSeconds, cbCfg.FailureThreshold, cbCfg.SuccessThreshold),
				resilience.GracefulDegradation("ml-eta-service"),
			)
		}
		logger.Info("ML ETA service URL configured", zap.String("url", mlEtaURL))
	}

	repo := rides.NewRepository(db)
	service := rides.NewService(cfg.Timeout, repo, promosServiceURL, promosBreaker)
	if mlEtaClient != nil {
		service.EnableMLPredictions(mlEtaClient, mlEtaBreaker)
	}

	surgeCalculator := pricing.NewSurgeCalculator(db.Primary)
	service.SetSurgeCalculator(surgeCalculator)
	logger.Info("Dynamic surge pricing enabled")

	geoServiceURL := os.Getenv("GEO_SERVICE_URL")
	if geoServiceURL == "" {
		geoServiceURL = "http://localhost:8083"
	}
	geoClient := httpclient.NewClient(cfg.Timeout, geoServiceURL)
	matchingProvider := rides.NewGeoMatchingProvider(geoClient, repo)
	if cfg.Resilience.CircuitBreaker.Enabled {
		cbCfg := cfg.Resilience.CircuitBreaker.SettingsFor("geo-service")
		geoBreaker := resilience.NewCircuitBreaker(
			resilience.BuildSettings(fmt.Sprintf("%s-geo", serviceName), cbCfg.IntervalSeconds, cbCfg.TimeoutSeconds, cbCfg.FailureThreshold, cbCfg.SuccessThreshold),
			resilience.StaticFallback([]byte("[]")),
		)
		matchingProvider.SetCircuitBreaker(geoBreaker)
	}
	matcher := rides.NewMatcher(rides.DefaultMatchingConfig(), matchingProvider)
	service.SetMatcher(matcher)
	logger.Info("Driver-rider matching engine enabled")

	if cfg.NATS.Enabled {
		bus, err := eventbus.New(eventbus.Config{
			URL:        cfg.NATS.URL,
			Name:       serviceName,
			StreamName: cfg.NATS.StreamName,
		})
		if err != nil {
			logger.Warn("Failed to connect to NATS - event bus disabled", zap.Error(err))
		} else {
			service.SetEventBus(bus)
			defer bus.Close()
			logger.Info("NATS event bus enabled", zap.String("url", cfg.NATS.URL))
		}
	}

	handler := rides.NewHandler(service)

	jwtProvider, err := jwtkeys.NewManagerFromConfig(rootCtx, cfg.JWT, true)
	if err != nil {
		logger.Fatal("Failed to initialize JWT key manager", zap.Error(err))
	}
	jwtProvider.StartAutoRefresh(rootCtx, time.Duration(cfg.JWT.RefreshMinutes)*time.Minute)

	if cfg.Server.Environment == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	router := gin.New()
	router.HandleMethodNotAllowed = true
	router.NoRoute(common.NoRouteHandler())
	router.NoMethod(common.NoMethodHandler())
	router.Use(middleware.CorrelationID())
	router.Use(middleware.RequestTimeout(&cfg.Timeout))
	router.Use(middleware.RequestLogger(serviceName))
	router.Use(middleware.CORS())
	router.Use(middleware.SecurityHeaders())
	router.Use(middleware.MaxBodySize(10 << 20))
	router.Use(middleware.SanitizeRequest())

	if redisClient != nil {
		router.Use(middleware.Idempotency(redisClient))
		logger.Info("Idempotency middleware enabled")
	}

	if tracerEnabled {
		router.Use(middleware.TracingMiddleware(serviceName))
	}

	router.Use(middleware.ErrorHandler())

	router.GET("/healthz", common.HealthCheck(serviceName, version))
	router.GET("/health/live", common.LivenessProbe(serviceName, version))

	healthChecks := make(map[string]func() error)

	if redisClient != nil {
		healthChecks["redis"] = func() error {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			return redisClient.Client.Ping(ctx).Err()
		}
	}

	router.GET("/health/ready", common.ReadinessProbe(serviceName, version, healthChecks))

	router.GET("/version", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"service": serviceName,
			"version": version,
		})
	})

	handler.RegisterRoutes(router, jwtProvider, limiter, cfg.RateLimit)

	srv := &http.Server{
		Addr:         ":" + cfg.Server.Port,
		Handler:      router,
		ReadTimeout:  time.Duration(cfg.Server.ReadTimeout) * time.Second,
		WriteTimeout: time.Duration(cfg.Server.WriteTimeout) * time.Second,
	}

	go func() {
		logger.Info("Server starting", zap.String("port", cfg.Server.Port))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("Failed to start server", zap.Error(err))
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info("Shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		logger.Fatal("Server forced to shutdown", zap.Error(err))
	}

	logger.Info("Server stopped")
}
