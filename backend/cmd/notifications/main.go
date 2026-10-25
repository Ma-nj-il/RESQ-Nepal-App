package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/bikky-kc013/medi-ambulance/internal/notifications"
	"github.com/bikky-kc013/medi-ambulance/pkg/common"
	"github.com/bikky-kc013/medi-ambulance/pkg/config"
	"github.com/bikky-kc013/medi-ambulance/pkg/database"
	"github.com/bikky-kc013/medi-ambulance/pkg/eventbus"
	"github.com/bikky-kc013/medi-ambulance/pkg/jwtkeys"
	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	"github.com/bikky-kc013/medi-ambulance/pkg/middleware"
	"github.com/bikky-kc013/medi-ambulance/pkg/resilience"
	"github.com/bikky-kc013/medi-ambulance/pkg/tracing"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

const (
	serviceName = "notifications-service"
	version     = "1.0.0"
)

func main() {
	if os.Getenv("PORT") == "" {
		os.Setenv("PORT", "8085")
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

	log := logger.Get()
	log.Info("Starting notifications service", zap.String("version", version))

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

	db, err := database.NewDBPool(&cfg.Database, []string{})
	if err != nil {
		logger.Fatal("Failed to connect to database", zap.Error(err))
	}
	defer db.Close()

	log.Info("Connected to database")

	var firebaseBreaker, twilioBreaker, smtpBreaker *resilience.CircuitBreaker
	if cfg.Resilience.CircuitBreaker.Enabled {
		firebaseBreaker = buildBreaker(serviceName+"-firebase", cfg.Resilience.CircuitBreaker.SettingsFor("firebase-fcm"))
		twilioBreaker = buildBreaker(serviceName+"-twilio", cfg.Resilience.CircuitBreaker.SettingsFor("twilio-sms"))
		smtpBreaker = buildBreaker(serviceName+"-smtp", cfg.Resilience.CircuitBreaker.SettingsFor("smtp-email"))
	}

	var firebaseClient *notifications.FirebaseClient
	switch {
	case cfg.Firebase.CredentialsJSON != "":
		firebaseClient, err = notifications.NewFirebaseClientFromJSON([]byte(cfg.Firebase.CredentialsJSON))
	case cfg.Firebase.CredentialsPath != "":
		firebaseClient, err = notifications.NewFirebaseClient(cfg.Firebase.CredentialsPath)
	}
	if err != nil {
		log.Warn("Failed to initialize Firebase client", zap.Error(err))
	} else if firebaseClient != nil {
		log.Info("Firebase client initialized")
	} else {
		log.Warn("Firebase credentials not provided, push notifications disabled")
	}

	var twilioClient *notifications.TwilioClient
	twilioAccountSid := cfg.Notifications.TwilioAccountSID
	twilioAuthToken := cfg.Notifications.TwilioAuthToken
	twilioFromNumber := cfg.Notifications.TwilioFromNumber
	if twilioAccountSid != "" && twilioAuthToken != "" && twilioFromNumber != "" {
		twilioClient = notifications.NewTwilioClient(twilioAccountSid, twilioAuthToken, twilioFromNumber)
		log.Info("Twilio client initialized")
	} else {
		log.Warn("Twilio credentials not set, SMS notifications disabled")
	}

	var emailClient *notifications.EmailClient
	smtpHost := cfg.Notifications.SMTPHost
	smtpPort := cfg.Notifications.SMTPPort
	smtpUsername := cfg.Notifications.SMTPUsername
	smtpPassword := cfg.Notifications.SMTPPassword
	smtpFromEmail := cfg.Notifications.SMTPFromEmail
	smtpFromName := cfg.Notifications.SMTPFromName

	if smtpHost != "" && smtpPort != "" {
		emailClient = notifications.NewEmailClient(
			smtpHost,
			smtpPort,
			smtpUsername,
			smtpPassword,
			smtpFromEmail,
			smtpFromName,
		)
		log.Info("Email client initialized")
	} else {
		log.Warn("SMTP credentials not set, email notifications disabled")
	}

	notificationRepo := notifications.NewRepository(db)
	notificationService := notifications.NewServiceWithClients(notificationRepo, firebaseClient, twilioClient, emailClient)
	notificationService.SetCircuitBreakers(firebaseBreaker, twilioBreaker, smtpBreaker)

	if cfg.NATS.Enabled {
		bus, err := eventbus.New(eventbus.Config{
			URL:        cfg.NATS.URL,
			Name:       serviceName,
			StreamName: cfg.NATS.StreamName,
		})
		if err != nil {
			log.Warn("Failed to connect to NATS - event-driven notifications disabled", zap.Error(err))
		} else {
			defer bus.Close()
			eventHandler := notifications.NewEventHandler(notificationService)
			if err := eventHandler.RegisterSubscriptions(context.Background(), bus); err != nil {
				log.Warn("Failed to register event subscriptions", zap.Error(err))
			} else {
				log.Info("NATS event subscriptions active", zap.String("url", cfg.NATS.URL))
			}
		}
	}

	notificationHandler := notifications.NewHandler(notificationService)

	go func() {
		ticker := time.NewTicker(1 * time.Minute)
		defer ticker.Stop()

		for range ticker.C {
			err := notificationService.ProcessPendingNotifications(context.Background())
			if err != nil {
				log.Error("Failed to process pending notifications", zap.Error(err))
			}
		}
	}()

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

	if tracerEnabled {
		router.Use(middleware.TracingMiddleware(serviceName))
	}

	router.Use(middleware.ErrorHandler())

	router.GET("/healthz", common.HealthCheck(serviceName, version))
	router.GET("/health/live", common.LivenessProbe(serviceName, version))

	healthChecks := make(map[string]func() error)
	healthChecks["database"] = func() error {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		return db.Ping(ctx)
	}

	router.GET("/health/ready", common.ReadinessProbe(serviceName, version, healthChecks))

	jwtProvider, err := jwtkeys.NewManagerFromConfig(rootCtx, cfg.JWT, true)
	if err != nil {
		logger.Fatal("Failed to initialize JWT key manager", zap.Error(err))
	}
	jwtProvider.StartAutoRefresh(rootCtx, time.Duration(cfg.JWT.RefreshMinutes)*time.Minute)

	notificationHandler.RegisterRoutes(router, jwtProvider)

	srv := &http.Server{
		Addr:         fmt.Sprintf(":%s", cfg.Server.Port),
		Handler:      router,
		ReadTimeout:  time.Duration(cfg.Server.ReadTimeout) * time.Second,
		WriteTimeout: time.Duration(cfg.Server.WriteTimeout) * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		log.Info("Server starting", zap.String("port", cfg.Server.Port), zap.String("environment", cfg.Server.Environment))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("Server failed to start", zap.Error(err))
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Info("Shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		logger.Fatal("Server forced to shutdown", zap.Error(err))
	}

	log.Info("Server stopped")
}

func buildBreaker(name string, cbCfg config.CircuitBreakerSettings) *resilience.CircuitBreaker {
	return resilience.NewCircuitBreaker(
		resilience.BuildSettings(name, cbCfg.IntervalSeconds, cbCfg.TimeoutSeconds, cbCfg.FailureThreshold, cbCfg.SuccessThreshold),
		resilience.GracefulDegradation(name),
	)
}
