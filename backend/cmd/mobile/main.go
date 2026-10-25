package main

import (
	"context"
	stdlog "log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/bikky-kc013/medi-ambulance/internal/cancellation"
	"github.com/bikky-kc013/medi-ambulance/internal/chat"
	"github.com/bikky-kc013/medi-ambulance/internal/demandforecast"
	"github.com/bikky-kc013/medi-ambulance/internal/disputes"
	"github.com/bikky-kc013/medi-ambulance/internal/documents"
	"github.com/bikky-kc013/medi-ambulance/internal/fraud"
	"github.com/bikky-kc013/medi-ambulance/internal/geography"
	"github.com/bikky-kc013/medi-ambulance/internal/negotiation"
	"github.com/bikky-kc013/medi-ambulance/internal/onboarding"
	"github.com/bikky-kc013/medi-ambulance/internal/pool"
	"github.com/bikky-kc013/medi-ambulance/internal/pricing"
	"github.com/bikky-kc013/medi-ambulance/internal/ratings"
	"github.com/bikky-kc013/medi-ambulance/internal/ridehistory"
	"github.com/bikky-kc013/medi-ambulance/internal/rides"
	"github.com/bikky-kc013/medi-ambulance/internal/ridetypes"
	"github.com/bikky-kc013/medi-ambulance/internal/safety"
	"github.com/bikky-kc013/medi-ambulance/internal/support"
	"github.com/bikky-kc013/medi-ambulance/internal/twofa"
	"github.com/bikky-kc013/medi-ambulance/internal/vehicle"
	"github.com/bikky-kc013/medi-ambulance/internal/waittime"
	"github.com/bikky-kc013/medi-ambulance/pkg/common"
	"github.com/bikky-kc013/medi-ambulance/pkg/config"
	"github.com/bikky-kc013/medi-ambulance/pkg/database"
	"github.com/bikky-kc013/medi-ambulance/pkg/jwtkeys"
	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	"github.com/bikky-kc013/medi-ambulance/pkg/middleware"
	"github.com/bikky-kc013/medi-ambulance/pkg/ratelimit"
	redisclient "github.com/bikky-kc013/medi-ambulance/pkg/redis"
	"github.com/bikky-kc013/medi-ambulance/pkg/tracing"
	ws "github.com/bikky-kc013/medi-ambulance/pkg/websocket"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

func main() {
	if os.Getenv("PORT") == "" {
		os.Setenv("PORT", "8087")
	}
	cfg, err := config.Load("mobile")
	if err != nil {
		stdlog.Fatalf("Failed to load config: %v", err)
	}
	defer cfg.Close()

	environment := os.Getenv("ENVIRONMENT")
	if environment == "" {
		environment = "development"
	}
	if err := logger.Init(environment); err != nil {
		stdlog.Fatalf("Failed to initialize logger: %v", err)
	}
	defer logger.Sync()

	port := getEnv("PORT", "8087")
	jwtSecret := getEnv("JWT_SECRET", "")
	rootCtx, cancelKeys := context.WithCancel(context.Background())
	defer cancelKeys()

	jwtProvider, err := jwtkeys.NewManager(rootCtx, jwtkeys.Config{
		KeyFilePath:      getEnv("JWT_KEYS_FILE", "config/jwt_keys.json"),
		RotationInterval: time.Duration(getEnvAsInt("JWT_ROTATION_HOURS", 24*30)) * time.Hour,
		GracePeriod:      time.Duration(getEnvAsInt("JWT_ROTATION_GRACE_HOURS", 24*30)) * time.Hour,
		LegacySecret:     jwtSecret,
		ReadOnly:         true,
	})
	if err != nil {
		logger.Fatal("Failed to initialize JWT key manager", zap.Error(err))
	}
	jwtProvider.StartAutoRefresh(rootCtx, time.Duration(getEnvAsInt("JWT_KEY_REFRESH_MINUTES", 5))*time.Minute)

	db, err := database.NewDBPool(&cfg.Database, nil, 30)
	if err != nil {
		logger.Fatal("Failed to connect to database", zap.Error(err))
	}
	defer db.Close()

	logger.Info("Connected to PostgreSQL database")

	var limiter *ratelimit.Limiter
	redisClient, redisErr := redisclient.NewRedisClient(&cfg.Redis)
	if redisErr != nil {
		logger.Warn("Failed to initialize Redis - rate limiting disabled", zap.Error(redisErr))
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

	tracerEnabled := os.Getenv("OTEL_ENABLED") == "true"
	if tracerEnabled {
		tracerCfg := tracing.Config{
			ServiceName:    os.Getenv("OTEL_SERVICE_NAME"),
			ServiceVersion: os.Getenv("OTEL_SERVICE_VERSION"),
			Environment:    getEnv("ENVIRONMENT", "development"),
			OTLPEndpoint:   os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT"),
			Enabled:        true,
		}

		tp, err := tracing.InitTracer(tracerCfg, logger.Get())
		if err != nil {
			logger.Warn("Failed to initialize tracer", zap.Error(err))
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

	promosServiceURL := getEnv("PROMOS_SERVICE_URL", "http://localhost:8089")
	logger.Info("Promos service URL configured", zap.String("url", promosServiceURL))

	wsHub := ws.NewHub()
	go wsHub.Run()

	ridesRepo := rides.NewRepository(db)
	cancellationRepo := cancellation.NewRepository(db)
	supportRepo := support.NewRepository(db)
	disputesRepo := disputes.NewRepository(db)
	ratingsRepo := ratings.NewRepository(db)
	vehicleRepo := vehicle.NewRepository(db)
	ridehistoryRepo := ridehistory.NewRepository(db)
	waittimeRepo := waittime.NewRepository(db)
	chatRepo := chat.NewRepository(db)
	twofaRepo := twofa.NewRepository(db)
	poolRepo := pool.NewRepository(db.Primary)
	onboardingRepo := onboarding.NewRepository(db.Primary)
	demandforecastRepo := demandforecast.NewRepository(db.Primary)
	fraudRepo := fraud.NewRepository(db)
	geographyRepo := geography.NewRepository(db)
	pricingRepo := pricing.NewRepository(db)
	negotiationRepo := negotiation.NewRepository(db)
	safetyRepo := safety.NewRepository(db.Primary)
	rideTypesRepo := ridetypes.NewRepository(db)
	documentsRepo := documents.NewRepository(db.Primary)

	ridesService := rides.NewService(cfg.Timeout, ridesRepo, promosServiceURL, nil)
	cancellationService := cancellation.NewService(cancellationRepo, db)
	supportService := support.NewService(supportRepo)
	disputesService := disputes.NewService(disputesRepo)
	ratingsService := ratings.NewService(ratingsRepo)
	vehicleService := vehicle.NewService(vehicleRepo)
	ridehistoryService := ridehistory.NewService(ridehistoryRepo)
	waittimeService := waittime.NewService(waittimeRepo)
	chatService := chat.NewService(chatRepo, wsHub)
	twofaService := twofa.NewService(twofaRepo, &stubSMSSender{}, nil, getEnv("APP_NAME", "RideHailing"))
	poolService := pool.NewService(poolRepo, &stubMapsService{}, pool.DefaultServiceConfig())
	onboardingService := onboarding.NewService(onboardingRepo, &stubDocumentService{}, nil)
	demandforecastService := demandforecast.NewService(demandforecastRepo, nil, nil, nil)
	fraudService := fraud.NewService(fraudRepo)
	geographyService := geography.NewService(geographyRepo)
	pricingService := pricing.NewService(pricingRepo, geographyService)
	ridesService.SetPricingService(pricingService)
	rideTypesService := ridetypes.NewService(rideTypesRepo, geographyService)
	negotiationService := negotiation.NewService(negotiationRepo, pricingService, geographyService)
	safetyService := safety.NewService(cfg.Timeout, safetyRepo, safety.Config{
		EmergencyNumber: getEnv("EMERGENCY_NUMBER", "112"),
	})
	documentsService := documents.NewService(documentsRepo, &stubStorage{}, documents.ServiceConfig{
		MaxFileSizeMB:    10,
		AllowedMimeTypes: []string{"image/jpeg", "image/png", "application/pdf"},
		OCREnabled:       false,
	})

	ridesHandler := rides.NewHandler(ridesService)
	cancellationHandler := cancellation.NewHandler(cancellationService)
	supportHandler := support.NewHandler(supportService)
	disputesHandler := disputes.NewHandler(disputesService)
	ratingsHandler := ratings.NewHandler(ratingsService)
	vehicleHandler := vehicle.NewHandler(vehicleService)
	ridehistoryHandler := ridehistory.NewHandler(ridehistoryService)
	waittimeHandler := waittime.NewHandler(waittimeService)
	chatHandler := chat.NewHandler(chatService)
	twofaHandler := twofa.NewHandler(twofaService)
	poolHandler := pool.NewHandler(poolService)
	onboardingHandler := onboarding.NewHandler(onboardingService)
	demandforecastHandler := demandforecast.NewHandler(demandforecastService)
	fraudHandler := fraud.NewHandler(fraudService)
	geographyHandler := geography.NewHandler(geographyService)
	pricingHandler := pricing.NewHandlerWithRideTypes(pricingService, &rideTypesServiceAdapter{service: rideTypesService})
	negotiationHandler := negotiation.NewHandler(negotiationService)
	rideTypesHandler := ridetypes.NewHandler(rideTypesService)
	safetyHandler := safety.NewHandler(safetyService)
	documentsHandler := documents.NewHandler(documentsService, &stubDriverService{})

	router := gin.New()
	router.HandleMethodNotAllowed = true
	router.NoRoute(common.NoRouteHandler())
	router.NoMethod(common.NoMethodHandler())
	router.Use(middleware.CorrelationID())
	router.Use(middleware.RequestTimeout(&cfg.Timeout))
	router.Use(middleware.SecurityHeaders())
	router.Use(middleware.MaxBodySize(10 << 20))
	router.Use(middleware.SanitizeRequest())

	if tracerEnabled {
		router.Use(middleware.TracingMiddleware("mobile-service"))
	}

	router.Use(middleware.RateLimit(limiter, cfg.RateLimit))

	router.Use(middleware.ErrorHandler())

	router.GET("/healthz", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "healthy", "service": "mobile-api", "version": "1.0.0"})
	})
	router.GET("/health/live", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "alive", "service": "mobile-api", "version": "1.0.0"})
	})

	healthChecks := make(map[string]func() error)

	router.GET("/health/ready", func(c *gin.Context) {
		allHealthy := true
		for name, check := range healthChecks {
			if err := check(); err != nil {
				c.JSON(503, gin.H{"status": "not ready", "service": "mobile-api", "failed_check": name, "error": err.Error()})
				allHealthy = false
				return
			}
		}
		if allHealthy {
			c.JSON(200, gin.H{"status": "ready", "service": "mobile-api", "version": "1.0.0"})
		}
	})

	api := router.Group("/api/v1")
	api.Use(middleware.AuthMiddlewareWithProvider(jwtProvider))
	{
		rides := api.Group("/rides")
		{
			rides.GET("/:id/receipt", ridesHandler.GetRideReceipt)
		}

		api.POST("/rides/:id/rate", ridesHandler.RateRide)

		api.GET("/profile", ridesHandler.GetUserProfile)
		api.PUT("/profile", ridesHandler.UpdateUserProfile)
	}

	cancellationHandler.RegisterRoutes(router, jwtProvider)
	supportHandler.RegisterRoutes(router, jwtProvider)
	disputesHandler.RegisterRoutes(router, jwtProvider)
	ratingsHandler.RegisterRoutes(router, jwtProvider)
	vehicleHandler.RegisterRoutes(router, jwtProvider)
	ridehistoryHandler.RegisterRoutes(router, jwtProvider)
	waittimeHandler.RegisterRoutes(router, jwtProvider)
	chatHandler.RegisterRoutes(router, jwtProvider)
	twofaHandler.RegisterRoutes(router, jwtProvider)
	poolHandler.RegisterRoutes(router, jwtProvider)
	onboardingHandler.RegisterRoutes(router, jwtProvider)
	demandforecastHandler.RegisterRoutes(router, jwtProvider)
	fraudHandler.RegisterRoutes(router, jwtProvider)

	apiGroup := router.Group("/api/v1")
	apiGroup.Use(middleware.AuthMiddlewareWithProvider(jwtProvider))
	geographyHandler.RegisterRoutes(apiGroup)
	pricingHandler.RegisterRoutes(apiGroup)
	negotiationHandler.RegisterRoutes(apiGroup)
	rideTypesHandler.RegisterRoutes(apiGroup)
	safetyHandler.RegisterRoutes(apiGroup)
	documentsHandler.RegisterRoutesOnGroup(apiGroup)

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      router,
		ReadTimeout:  time.Duration(cfg.Server.ReadTimeout) * time.Second,
		WriteTimeout: time.Duration(cfg.Server.WriteTimeout) * time.Second,
	}

	go func() {
		logger.Info("Mobile API service starting", zap.String("port", port))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("Failed to start server", zap.Error(err))
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info("Shutting down server...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Fatal("Server forced to shutdown", zap.Error(err))
	}

	logger.Info("Server stopped")
}

func getEnv(key, defaultValue string) string {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	return value
}

func getEnvAsInt(key string, defaultValue int) int {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	if parsed, err := strconv.Atoi(value); err == nil {
		return parsed
	}
	return defaultValue
}
