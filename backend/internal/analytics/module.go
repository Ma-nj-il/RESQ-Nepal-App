package analytics

import (
	"context"
	"net/http"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/common"
	"github.com/bikky-kc013/medi-ambulance/pkg/config"
	"github.com/bikky-kc013/medi-ambulance/pkg/database"
	"github.com/bikky-kc013/medi-ambulance/pkg/jwtkeys"
	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	"github.com/bikky-kc013/medi-ambulance/pkg/middleware"
	"github.com/gin-gonic/gin"
	"go.uber.org/fx"
	"go.uber.org/zap"
)

const (
	serviceName = "analytics-service"
	servicePort = "8091"
)

func AppModule() fx.Option {
	return fx.Options(
		fx.Provide(func() context.Context {
			return context.Background()
		}),
		fx.Provide(func() (*config.Config, error) {
			return config.Load(serviceName)
		}),

		fx.Provide(func(cfg *config.Config) (*zap.Logger, error) {
			if err := logger.Init(cfg.Server.Environment); err != nil {
				return nil, err
			}
			return logger.Get(), nil
		}),

		fx.Provide(func(cfg *config.Config) (*database.DBPool, error) {
			return database.NewPostgresPool(&cfg.Database, cfg.Timeout.DatabaseQueryTimeout)
		}),

		fx.Provide(func(cfg *config.Config) jwtkeys.Config {
			return jwtkeys.Config{
				KeyFilePath:      cfg.JWT.KeyFile,
				RotationInterval: time.Duration(cfg.JWT.RotationHours) * time.Hour,
				GracePeriod:      time.Duration(cfg.JWT.GraceHours) * time.Hour,
				LegacySecret:     cfg.JWT.Secret,
			}
		}),
		fx.Provide(func(ctx context.Context, cfg jwtkeys.Config) (*jwtkeys.Manager, error) {
			return jwtkeys.NewManager(ctx, cfg)
		}),
		fx.Provide(fx.Annotate(
			func(m *jwtkeys.Manager) jwtkeys.KeyProvider { return m },
			fx.As(new(jwtkeys.KeyProvider)),
		)),

		fx.Provide(NewRepository),
		fx.Provide(func(r *Repository) AnalyticsRepository { return r }),
		fx.Provide(NewService),
		fx.Provide(NewHandler),

		fx.Provide(func(
			cfg *config.Config,
			handler *Handler,
			jwtProvider jwtkeys.KeyProvider,
		) *gin.Engine {

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

			router.GET("/healthz", handler.HealthCheck)

			api := router.Group("/api/v1/analytics")
			api.Use(middleware.AuthMiddlewareWithProvider(jwtProvider))
			api.Use(middleware.RequireAdmin())
			{
				api.GET("/dashboard", handler.GetDashboardMetrics)
				api.GET("/revenue", handler.GetRevenueMetrics)
			}

			return router
		}),

		fx.Invoke(func(
			lifecycle fx.Lifecycle,
			cfg *config.Config,
			router *gin.Engine,
			logger *zap.Logger,
		) {
			server := &http.Server{
				Addr:         ":" + servicePort,
				Handler:      router,
				ReadTimeout:  time.Duration(cfg.Server.ReadTimeout) * time.Second,
				WriteTimeout: time.Duration(cfg.Server.WriteTimeout) * time.Second,
			}

			lifecycle.Append(fx.Hook{
				OnStart: func(ctx context.Context) error {
					go func() {
						logger.Info("Starting server", zap.String("port", server.Addr))
						if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
							logger.Fatal("Server failed", zap.Error(err))
						}
					}()
					return nil
				},
				OnStop: func(ctx context.Context) error {
					logger.Info("Shutting down server")
					return server.Shutdown(ctx)
				},
			})
		}),
	)
}
