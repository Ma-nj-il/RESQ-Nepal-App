package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/bikky-kc013/medi-ambulance/internal/auth"
	"github.com/bikky-kc013/medi-ambulance/pkg/common"
	"github.com/bikky-kc013/medi-ambulance/pkg/config"
	"github.com/bikky-kc013/medi-ambulance/pkg/database"
	"github.com/bikky-kc013/medi-ambulance/pkg/jwtkeys"
	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	"github.com/bikky-kc013/medi-ambulance/pkg/middleware"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

const (
	serviceName = "auth-service"
	version     = "1.0.0"
)

func main() {

	if os.Getenv("PORT") == "" {
		os.Setenv("PORT", "8081")
	}

	cfg, err := config.Load(serviceName)
	if err != nil {
		panic(fmt.Sprintf("failed to load config: %v", err))
	}
	defer cfg.Close()

	rootCtx, cancelRotation := context.WithCancel(context.Background())
	defer cancelRotation()

	if err := logger.Init(cfg.Server.Environment); err != nil {
		panic(fmt.Sprintf("failed to initialize logger: %v", err))
	}
	defer logger.Sync()

	appLogger := logger.Get()

	appLogger.Info("Starting auth service",
		zap.String("service", serviceName),
		zap.String("version", version),
		zap.String("environment", cfg.Server.Environment),
	)

	db, err := database.NewDBPool(&cfg.Database, nil, cfg.Timeout.DatabaseQueryTimeout)
	if err != nil {
		appLogger.Fatal("Failed to connect to database", zap.Error(err))
	}
	defer db.Close()

	appLogger.Info("Connected to database")

	repo := auth.NewRepository(db)

	keyManager, err := jwtkeys.NewManagerFromConfig(rootCtx, cfg.JWT, false)
	if err != nil {
		appLogger.Fatal("Failed to initialize JWT key manager", zap.Error(err))
	}
	keyManager.StartAutoRotation(rootCtx)

	service := auth.NewService(repo, keyManager, cfg.JWT.Expiration, appLogger)

	handler := auth.NewHandler(service)

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
	router.Use(middleware.ErrorHandler())

	router.GET("/healthz", common.HealthCheck(serviceName, version))
	router.GET("/health/live", common.LivenessProbe(serviceName, version))

	healthChecks := map[string]func() error{
		"database": func() error {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			return db.Ping(ctx)
		},
	}

	router.GET("/health/ready", common.ReadinessProbe(serviceName, version, healthChecks))

	router.GET("/version", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"service": serviceName,
			"version": version,
		})
	})

	routes := auth.NewRouter(handler)
	routes.RegisterRoutes(router, keyManager)

	srv := &http.Server{
		Addr:         ":" + cfg.Server.Port,
		Handler:      router,
		ReadTimeout:  time.Duration(cfg.Server.ReadTimeout) * time.Second,
		WriteTimeout: time.Duration(cfg.Server.WriteTimeout) * time.Second,
	}

	go func() {
		appLogger.Info("Server starting",
			zap.String("port", cfg.Server.Port),
		)

		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			appLogger.Fatal("Failed to start server", zap.Error(err))
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	appLogger.Info("Shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		appLogger.Fatal("Server forced to shutdown", zap.Error(err))
	}

	appLogger.Info("Server stopped")
}
