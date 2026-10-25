package main

import (
	"context"
	"database/sql"
	stdlog "log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/bikky-kc013/medi-ambulance/internal/geo"
	"github.com/bikky-kc013/medi-ambulance/internal/matching"
	"github.com/bikky-kc013/medi-ambulance/internal/realtime"
	"github.com/bikky-kc013/medi-ambulance/pkg/common"
	"github.com/bikky-kc013/medi-ambulance/pkg/config"
	"github.com/bikky-kc013/medi-ambulance/pkg/eventbus"
	"github.com/bikky-kc013/medi-ambulance/pkg/jwtkeys"
	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	"github.com/bikky-kc013/medi-ambulance/pkg/middleware"
	"github.com/bikky-kc013/medi-ambulance/pkg/redis"
	"github.com/bikky-kc013/medi-ambulance/pkg/tracing"
	ws "github.com/bikky-kc013/medi-ambulance/pkg/websocket"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	_ "github.com/lib/pq"
	"go.uber.org/zap"
)

type stubRidesRepository struct {
	db *sql.DB
}

func (r *stubRidesRepository) UpdateRideDriver(ctx context.Context, rideID, driverID uuid.UUID) error {
	query := `UPDATE rides SET driver_id = $1, status = 'accepted', updated_at = NOW() WHERE id = $2`
	_, err := r.db.ExecContext(ctx, query, driverID, rideID)
	return err
}

func (r *stubRidesRepository) GetRideByID(ctx context.Context, rideID uuid.UUID) (interface{}, error) {
	var status string
	query := `SELECT status FROM rides WHERE id = $1`
	err := r.db.QueryRowContext(ctx, query, rideID).Scan(&status)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"status": status}, nil
}

type geoServiceAdapter struct {
	*geo.Service
}

func (a *geoServiceAdapter) FindAvailableDrivers(ctx context.Context, latitude, longitude float64, maxDrivers int) ([]*matching.GeoDriverLocation, error) {
	drivers, err := a.Service.FindAvailableDrivers(ctx, latitude, longitude, maxDrivers)
	if err != nil {
		return nil, err
	}

	result := make([]*matching.GeoDriverLocation, len(drivers))
	for i, d := range drivers {
		result[i] = &matching.GeoDriverLocation{
			DriverID:  d.DriverID,
			Latitude:  d.Latitude,
			Longitude: d.Longitude,
			Status:    d.Status,
		}
	}
	return result, nil
}

func (a *geoServiceAdapter) CalculateDistance(latitude1, longitude1, latitude2, longitude2 float64) float64 {
	return a.Service.CalculateDistance(latitude1, longitude1, latitude2, longitude2)
}

func main() {
	if os.Getenv("PORT") == "" {
		os.Setenv("PORT", "8086")
	}
	cfg, err := config.Load("realtime")
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

	port := cfg.Server.Port

	rootCtx, cancelKeys := context.WithCancel(context.Background())
	defer cancelKeys()

	jwtProvider, err := jwtkeys.NewManagerFromConfig(rootCtx, cfg.JWT, true)
	if err != nil {
		logger.Fatal("Failed to initialize JWT key manager", zap.Error(err))
	}
	jwtProvider.StartAutoRefresh(rootCtx, time.Duration(cfg.JWT.RefreshMinutes)*time.Minute)

	dsn := cfg.Database.DSN()

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		logger.Fatal("Failed to connect to database", zap.Error(err))
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		logger.Fatal("Failed to ping database", zap.Error(err))
	}
	logger.Info("Connected to PostgreSQL database")

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

	redisClient, err := redis.NewRedisClient(&cfg.Redis)
	if err != nil {
		logger.Fatal("Failed to connect to Redis", zap.Error(err))
	}
	logger.Info("Connected to Redis")

	hub := ws.NewHub()
	go hub.Run()
	logger.Info("WebSocket hub started")

	var eventBus *eventbus.Bus
	if cfg.NATS.Enabled {
		eventBusCfg := eventbus.Config{
			URL:        cfg.NATS.URL,
			Name:       "realtime-service",
			StreamName: cfg.NATS.StreamName,
		}
		eventBus, err = eventbus.New(eventBusCfg)
		if err != nil {
			logger.Fatal("Failed to connect to NATS", zap.Error(err))
		}
		logger.Info("Connected to NATS event bus")
	}

	geoService := geo.NewService(redisClient)
	geoAdapter := &geoServiceAdapter{Service: geoService}

	stubRidesRepo := &stubRidesRepository{db: db}

	if eventBus != nil {
		matchingConfig := matching.DefaultMatchingConfig()
		matchingSvc := matching.NewService(
			geoAdapter,
			stubRidesRepo,
			hub,
			eventBus.Conn(),
			redisClient,
			matchingConfig,
		)

		ctx := context.Background()
		if err := matchingSvc.Start(ctx); err != nil {
			logger.Fatal("Failed to start matching service", zap.Error(err))
		}
		logger.Info("Matching service started")
	} else {
		logger.Warn("NATS not enabled, matching service will not start")
	}

	log := logger.Get()
	service := realtime.NewService(hub, db, redisClient, log)
	handler := realtime.NewHandler(service, log)

	if cfg.Server.Environment == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	router := gin.New()
	router.HandleMethodNotAllowed = true
	router.NoRoute(common.NoRouteHandler())
	router.NoMethod(common.NoMethodHandler())

	router.Use(middleware.Recovery())
	router.Use(middleware.CorrelationID())
	router.Use(middleware.RequestTimeout(&cfg.Timeout))
	router.Use(middleware.RequestLogger("realtime-service"))
	router.Use(middleware.SecurityHeaders())
	router.Use(middleware.MaxBodySize(10 << 20))
	router.Use(middleware.SanitizeRequest())

	if tracerEnabled {
		router.Use(middleware.TracingMiddleware("realtime-service"))
	}

	router.Use(middleware.ErrorHandler())

	corsConfig := cors.DefaultConfig()
	if cfg.Server.CORSOrigins != "" {
		origins := strings.Split(cfg.Server.CORSOrigins, ",")
		for i := range origins {
			origins[i] = strings.TrimSpace(origins[i])
		}
		corsConfig.AllowOrigins = origins
		logger.Info("CORS configured with origins", zap.Strings("origins", origins))
	} else {
		corsConfig.AllowOrigins = []string{"http://localhost:3000"}
		logger.Info("CORS configured for development (localhost:3000)")
	}
	corsConfig.AllowMethods = []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"}
	corsConfig.AllowHeaders = []string{"Origin", "Content-Type", "Authorization"}
	corsConfig.AllowCredentials = true
	router.Use(cors.New(corsConfig))

	router.GET("/healthz", handler.HealthCheck)
	router.GET("/health/live", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "alive", "service": "realtime-service", "version": "1.0.0"})
	})

	healthChecks := make(map[string]func() error)
	healthChecks["database"] = func() error {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		return db.PingContext(ctx)
	}
	healthChecks["redis"] = func() error {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		return redisClient.Client.Ping(ctx).Err()
	}

	router.GET("/health/ready", func(c *gin.Context) {
		allHealthy := true
		for name, check := range healthChecks {
			if err := check(); err != nil {
				c.JSON(503, gin.H{"status": "not ready", "service": "realtime-service", "failed_check": name, "error": err.Error()})
				allHealthy = false
				return
			}
		}
		if allHealthy {
			c.JSON(200, gin.H{"status": "ready", "service": "realtime-service", "version": "1.0.0"})
		}
	})

	api := router.Group("/api/v1")
	{
		api.GET("/ws", middleware.AuthMiddlewareWithProvider(jwtProvider), handler.HandleWebSocket)

		api.GET("/rides/:ride_id/chat", middleware.AuthMiddlewareWithProvider(jwtProvider), handler.GetChatHistory)

		api.GET("/drivers/:driver_id/location", middleware.AuthMiddlewareWithProvider(jwtProvider), handler.GetDriverLocation)

		api.GET("/stats", middleware.AuthMiddlewareWithProvider(jwtProvider), middleware.RequireAdmin(), handler.GetStats)

		internal := api.Group("/internal")
		internal.Use(middleware.InternalAPIKey())
		{
			internal.POST("/broadcast/ride", handler.BroadcastRideUpdate)
			internal.POST("/broadcast/user", handler.BroadcastToUser)
		}
	}

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      router,
		ReadTimeout:  time.Duration(cfg.Server.ReadTimeout) * time.Second,
		WriteTimeout: time.Duration(cfg.Server.WriteTimeout) * time.Second,
	}

	go func() {
		logger.Info("Real-time service starting", zap.String("port", port))
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
