package auth

import (
	"context"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/config"
	"github.com/bikky-kc013/medi-ambulance/pkg/database"
	"github.com/bikky-kc013/medi-ambulance/pkg/jwtkeys"
	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	"go.uber.org/fx"
	"go.uber.org/zap"
)

const (
	serviceName = "auth-service"
	servicePort = "8081"
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

	)
}
