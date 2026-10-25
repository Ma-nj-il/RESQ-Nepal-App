package main

import (
	"context"
	"net/http"
	"os"
	"time"

	"github.com/bikky-kc013/medi-ambulance/internal/admin"
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
	"github.com/bikky-kc013/medi-ambulance/pkg/jwtkeys"
	"github.com/gin-gonic/gin"
	"go.uber.org/fx"
	"go.uber.org/zap"
)

type AppParams struct {
	fx.In
	Lifecycle       fx.Lifecycle
	Config          *config.Config
	Logger          *zap.Logger
	JWTKeyProvider  jwtkeys.KeyProvider
	AdminH          *admin.Handler
	GeoH            *geography.AdminHandler
	PricingH        *pricing.AdminHandler
	RideTypesH      *ridetypes.AdminHandler
	DisputesH       *disputes.Handler
	SupportH        *support.Handler
	CancellationH   *cancellation.Handler
	AnalyticsH      *analytics.Handler
	FraudH          *fraud.Handler
	DocumentsH      *documents.Handler
	VehicleH        *vehicle.Handler
	AdminRoutes     *admin.Routes
	Router          *gin.Engine
	AnalyticsRoutes *analytics.Routes
}

func main() {
	if os.Getenv("PORT") == "" {
		os.Setenv("PORT", "8088")
	}

	app := fx.New(
		admin.AppModules(),
		fx.Invoke(RegisterRoutes),
		fx.Invoke(StartHTTPServer),
	)
	app.Run()
}

func RegisterRoutes(p AppParams) {
	api := p.Router.Group("/api/v1/admin")

	p.AdminRoutes.RegisterRoutes(api, p.JWTKeyProvider)
	p.GeoH.RegisterRoutes(api)
	p.PricingH.RegisterRoutes(api)
	p.RideTypesH.RegisterRoutes(api)
	p.DisputesH.RegisterAdminRoutes(api)
	p.SupportH.RegisterAdminRoutes(api)
	p.CancellationH.RegisterAdminRoutes(api)
	p.FraudH.RegisterAdminRoutes(api)
	p.DocumentsH.RegisterAdminRoutes(api)
	p.VehicleH.RegisterAdminRoutes(api)
	p.AnalyticsRoutes.RegisterRoutes(&p.Router.RouterGroup)
}

func StartHTTPServer(p AppParams) {
	p.Lifecycle.Append(fx.Hook{
		OnStart: func(ctx context.Context) error {
			port := p.Config.Server.Port

			srv := &http.Server{
				Addr:         ":" + port,
				Handler:      p.Router,
				ReadTimeout:  time.Duration(p.Config.Server.ReadTimeout) * time.Second,
				WriteTimeout: time.Duration(p.Config.Server.WriteTimeout) * time.Second,
			}

			go func() {
				p.Logger.Info("Admin service starting", zap.String("port", port))
				if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
					p.Logger.Error("Failed to start server", zap.Error(err))
				}
			}()

			return nil
		},
		OnStop: func(ctx context.Context) error {
			p.Logger.Info("Shutting down server")
			return nil
		},
	})
}
