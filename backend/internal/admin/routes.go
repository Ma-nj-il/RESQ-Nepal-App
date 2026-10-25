package admin

import (
	"github.com/bikky-kc013/medi-ambulance/pkg/common"
	"github.com/bikky-kc013/medi-ambulance/pkg/jwtkeys"
	"github.com/bikky-kc013/medi-ambulance/pkg/middleware"
	"github.com/bikky-kc013/medi-ambulance/pkg/models"
	"github.com/gin-gonic/gin"
)

type Routes struct {
	handler *Handler
}

func NewRouter(handler *Handler) *Routes {
	return &Routes{handler: handler}
}

func (h *Routes) RegisterRoutes(rg *gin.RouterGroup, jwt jwtkeys.KeyProvider) {

	rg.Use(middleware.AuthMiddlewareWithProvider(jwt))
	rg.Use(middleware.RequireRole(models.RoleAdmin))

	rg.GET("/dashboard", h.handler.GetDashboard)

	dashboard := rg.Group("/dashboard")
	{
		dashboard.GET("/realtime", h.handler.GetRealtimeMetrics)
		dashboard.GET("/summary", h.handler.GetDashboardSummary)
		dashboard.GET("/revenue-trend", h.handler.GetRevenueTrend)
		dashboard.GET("/action-items", h.handler.GetActionItems)
	}

	users := rg.Group("/users")
	{
		users.GET("", h.handler.GetAllUsers)
		users.GET("/:id", h.handler.GetUser)
		users.POST("/:id/suspend", h.handler.SuspendUser)
		users.POST("/:id/activate", h.handler.ActivateUser)
	}

	drivers := rg.Group("/drivers")
	{
		drivers.GET("", h.handler.GetAllDrivers)
		drivers.GET("/pending", h.handler.GetPendingDrivers)
		drivers.GET("/:id", h.handler.GetDriver)
		drivers.POST("/:id/approve", h.handler.ApproveDriver)
		drivers.POST("/:id/reject", h.handler.RejectDriver)
	}

	rides := rg.Group("/rides")
	{
		rides.GET("/recent", h.handler.GetRecentRides)
		rides.GET("/stats", h.handler.GetRideStats)
		rides.GET("/:id", h.handler.GetRide)
	}

	rg.GET("/audit-logs", h.handler.GetAuditLogs)
	rg.GET("/healthz", h.handler.HealthCheck)
	rg.GET("/health/live", func(c *gin.Context) {
		common.SuccessResponse(c, gin.H{"status": "alive", "service": "admin-service", "version": "1.0.0"})
	})
	rg.GET("/health/ready", func(c *gin.Context) {
		common.SuccessResponse(c, gin.H{"status": "ready", "service": "admin-service", "version": "1.0.0"})
	})
}
