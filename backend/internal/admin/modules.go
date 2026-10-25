package admin

import (
	"context"
	"time"

	"github.com/bikky-kc013/medi-ambulance/internal/adapters"
	"github.com/bikky-kc013/medi-ambulance/internal/analytics"
	"github.com/bikky-kc013/medi-ambulance/internal/cancellation"
	"github.com/bikky-kc013/medi-ambulance/internal/disputes"
	"github.com/bikky-kc013/medi-ambulance/internal/documents"
	"github.com/bikky-kc013/medi-ambulance/internal/fraud"
	"github.com/bikky-kc013/medi-ambulance/internal/geography"
	"github.com/bikky-kc013/medi-ambulance/internal/pricing"
	"github.com/bikky-kc013/medi-ambulance/internal/ridetypes"
	"github.com/bikky-kc013/medi-ambulance/internal/support"
	"github.com/bikky-kc013/medi-ambulance/internal/vehicle"
	"github.com/bikky-kc013/medi-ambulance/pkg/config"
	"github.com/bikky-kc013/medi-ambulance/pkg/database"
	"github.com/bikky-kc013/medi-ambulance/pkg/jwtkeys"
	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	"github.com/bikky-kc013/medi-ambulance/pkg/middleware"
	"github.com/bikky-kc013/medi-ambulance/pkg/storage"
	"github.com/gin-gonic/gin"
	"go.uber.org/fx"
	"go.uber.org/zap"
)

func AppModules() fx.Option {
	return fx.Options(
		fx.Provide(func() context.Context {
			return context.Background()
		}),
		fx.Provide(func() (*config.Config, error) {
			return config.Load("admin-service")
		}),
		fx.Provide(func(cfg *config.Config) *zap.Logger {
			return logger.Get()
		}),
		fx.Provide(func(cfg *config.Config) *config.JWTConfig {
			return &cfg.JWT
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
		fx.Provide(fx.Annotate(func(m *jwtkeys.Manager) jwtkeys.KeyProvider {
			return m
		}, fx.As(new(jwtkeys.KeyProvider)))),
		fx.Provide(func(cfg *config.Config) *config.DatabaseConfig {
			return &cfg.Database
		}),
		fx.Provide(func(cfg *config.DatabaseConfig, fullCfg *config.Config) (*database.DBPool, error) {
			return database.NewDBPool(cfg, nil, fullCfg.Timeout.DatabaseQueryTimeout)
		}),

		fx.Provide(NewRepository),
		fx.Provide(func(repo *Repository) RepositoryInterface { return repo }),
		fx.Provide(NewService),
		fx.Provide(NewHandler),
		fx.Provide(NewRouter),

		fx.Provide(geography.NewRepository),
		fx.Provide(func(repo *geography.Repository) geography.RepositoryInterface { return repo }),
		fx.Provide(geography.NewService),
		fx.Provide(geography.NewAdminHandler),

		fx.Provide(pricing.NewRepository),
		fx.Provide(func(repo *pricing.Repository) pricing.RepositoryInterface { return repo }),
		fx.Provide(pricing.NewService),
		fx.Provide(pricing.NewAdminHandler),

		fx.Provide(ridetypes.NewRepository),
		fx.Provide(func(repo *ridetypes.Repository) ridetypes.RepositoryInterface { return repo }),
		fx.Provide(ridetypes.NewService),
		fx.Provide(ridetypes.NewAdminHandler),

		fx.Provide(disputes.NewRepository),
		fx.Provide(func(repo *disputes.Repository) disputes.RepositoryInterface { return repo }),
		fx.Provide(disputes.NewService),
		fx.Provide(disputes.NewHandler),

		fx.Provide(support.NewRepository),
		fx.Provide(func(repo *support.Repository) support.RepositoryInterface { return repo }),
		fx.Provide(support.NewService),
		fx.Provide(support.NewHandler),

		fx.Provide(cancellation.NewRepository),
		fx.Provide(func(repo *cancellation.Repository) cancellation.RepositoryInterface { return repo }),
		fx.Provide(cancellation.NewService),
		fx.Provide(cancellation.NewHandler),

		fx.Provide(analytics.NewRepository),
		fx.Provide(func(repo *analytics.Repository) analytics.AnalyticsRepository { return repo }),
		fx.Provide(analytics.NewService),
		fx.Provide(analytics.NewHandler),
		fx.Provide(analytics.NewRouter),

		fx.Provide(fraud.NewRepository),
		fx.Provide(func(repo *fraud.Repository) fraud.FraudRepository { return repo }),
		fx.Provide(fraud.NewService),
		fx.Provide(fraud.NewHandler),

		fx.Provide(func(db *database.DBPool) *documents.Repository {
			return documents.NewRepository(db.Primary)
		}),
		fx.Provide(func(repo *documents.Repository) documents.RepositoryInterface { return repo }),
		fx.Provide(func(repo documents.RepositoryInterface) storage.Storage {
			return &adapters.StubStorage{}
		}),
		fx.Provide(func(repo documents.RepositoryInterface, st storage.Storage) *documents.Service {
			return documents.NewService(repo, st, documents.ServiceConfig{})
		}),
		fx.Provide(func(svc *documents.Service) *documents.Handler {
			return documents.NewHandler(svc, &adapters.StubDriverService{})
		}),

		fx.Provide(vehicle.NewRepository),
		fx.Provide(func(repo *vehicle.Repository) vehicle.RepositoryInterface { return repo }),
		fx.Provide(vehicle.NewService),
		fx.Provide(vehicle.NewHandler),

		fx.Provide(func(cfg *config.Config, log *zap.Logger) *gin.Engine {
			if cfg.Server.Environment == "production" {
				gin.SetMode(gin.ReleaseMode)
			}
			r := gin.New()
			r.Use(gin.Recovery())
			r.Use(middleware.CORS())
			r.Use(middleware.RequestLogger("AdminService"))
			r.Use(middleware.SecurityHeaders())
			r.Use(middleware.MaxBodySize(10 << 20))
			return r
		}),
	)
}
