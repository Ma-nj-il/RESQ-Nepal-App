package main

import (
	"context"
	stdlog "log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/bikky-kc013/medi-ambulance/internal/mleta"
	"github.com/bikky-kc013/medi-ambulance/pkg/common"
	"github.com/bikky-kc013/medi-ambulance/pkg/config"
	"github.com/bikky-kc013/medi-ambulance/pkg/database"
	"github.com/bikky-kc013/medi-ambulance/pkg/jwtkeys"
	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	"github.com/bikky-kc013/medi-ambulance/pkg/middleware"
	redisClient "github.com/bikky-kc013/medi-ambulance/pkg/redis"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

const serviceName = "ml-eta"

func main() {
	if os.Getenv("PORT") == "" {
		os.Setenv("PORT", "8093")
	}
	cfg, err := config.Load("ml-eta")
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

	rootCtx, cancelKeys := context.WithCancel(context.Background())
	defer cancelKeys()

	db, err := database.NewDBPool(&cfg.Database, []string{})
	if err != nil {
		logger.Fatal("Failed to connect to database", zap.Error(err))
	}
	defer db.Close()

	redis, err := redisClient.NewRedisClient(&cfg.Redis)
	if err != nil {
		logger.Fatal("Failed to connect to Redis", zap.Error(err))
	}
	defer redis.Close()

	repo := mleta.NewRepository(db, redis)
	service := mleta.NewService(repo, redis)
	handler := mleta.NewHandler(service)

	jwtProvider, err := jwtkeys.NewManagerFromConfig(rootCtx, cfg.JWT, true)
	if err != nil {
		logger.Fatal("Failed to initialize JWT key manager", zap.Error(err))
	}
	jwtProvider.StartAutoRefresh(rootCtx, time.Duration(cfg.JWT.RefreshMinutes)*time.Minute)

	go service.StartModelTrainingWorker(rootCtx)

	gin.SetMode(gin.ReleaseMode)
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

	router.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "healthy", "service": "ml-eta", "version": "1.0.0"})
	})
	router.GET("/health/live", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "alive", "service": "ml-eta", "version": "1.0.0"})
	})

	healthChecks := make(map[string]func() error)
	healthChecks["database"] = func() error {
		pingCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		return db.Ping(pingCtx)
	}
	healthChecks["redis"] = func() error {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		return redis.Client.Ping(ctx).Err()
	}

	router.GET("/health/ready", func(c *gin.Context) {
		allHealthy := true
		for name, check := range healthChecks {
			if err := check(); err != nil {
				c.JSON(http.StatusServiceUnavailable, gin.H{"status": "not ready", "service": "ml-eta", "failed_check": name, "error": err.Error()})
				allHealthy = false
				return
			}
		}
		if allHealthy {
			c.JSON(http.StatusOK, gin.H{"status": "ready", "service": "ml-eta", "version": "1.0.0"})
		}
	})

	api := router.Group("/api/v1/eta")
	{
		api.POST("/predict", handler.PredictETA)
		api.POST("/predict/batch", handler.BatchPredictETA)

		admin := api.Group("")
		admin.Use(middleware.AuthMiddlewareWithProvider(jwtProvider))
		admin.Use(middleware.RequireAdmin())
		{
			admin.POST("/train", handler.TriggerModelTraining)
			admin.GET("/model/stats", handler.GetModelStats)
			admin.GET("/model/accuracy", handler.GetModelAccuracy)
			admin.POST("/model/tune", handler.TuneHyperparameters)
		}

		analytics := api.Group("/analytics")
		analytics.Use(middleware.AuthMiddlewareWithProvider(jwtProvider))
		{
			analytics.GET("/predictions", handler.GetPredictionHistory)
			analytics.GET("/accuracy", handler.GetAccuracyTrends)
			analytics.GET("/features", handler.GetFeatureImportance)
		}
	}

	port := cfg.Server.Port
	if port == "" {
		port = "8080"
	}

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		logger.Info("ML ETA Service starting", zap.String("port", port))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("Failed to start server", zap.Error(err))
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info("Shutting down ML ETA Service...")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		logger.Fatal("Server forced to shutdown", zap.Error(err))
	}

	logger.Info("ML ETA Service stopped")
}
