package analytics

import (
	"github.com/gin-gonic/gin"
)

type Routes struct {
	handler *Handler
}

func NewRouter(handler *Handler) *Routes {
	return &Routes{handler: handler}
}

func (r *Routes) RegisterRoutes(rg *gin.RouterGroup) {
	analytics := rg.Group("/analytics")
	{
		analytics.GET("/dashboard", r.handler.GetDashboardMetrics)
		analytics.GET("/revenue", r.handler.GetRevenueMetrics)
		analytics.GET("/revenue/time-series", r.handler.GetRevenueTimeSeries)
		analytics.GET("/revenue/hourly", r.handler.GetHourlyDistribution)
		analytics.GET("/rides", r.handler.GetRideMetrics)
		analytics.GET("/ride-types", r.handler.GetRideTypeStats)
		analytics.GET("/drivers", r.handler.GetDriverAnalytics)
		analytics.GET("/drivers/top", r.handler.GetTopDrivers)
		analytics.GET("/drivers/top/detailed", r.handler.GetTopDriversDetailed)
		analytics.GET("/riders/growth", r.handler.GetRiderGrowth)
		analytics.GET("/demand/heatmap", r.handler.GetDemandHeatMap)
		analytics.GET("/demand/zones", r.handler.GetDemandZones)
		analytics.GET("/financial-report", r.handler.GetFinancialReport)
		analytics.GET("/period-comparison", r.handler.GetPeriodComparison)
	}
}
