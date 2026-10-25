package analytics

import (
	"net/http"
	"strconv"
	"time"

	"github.com/bikky-kc013/medi-ambulance/internal/analytics/models"
	"github.com/bikky-kc013/medi-ambulance/pkg/common"
	"github.com/gin-gonic/gin"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) GetRevenueMetrics(c *gin.Context) {
	startDate, endDate, err := parseDateRange(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	metrics, err := h.service.GetRevenueMetrics(c.Request.Context(), startDate, endDate)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get revenue metrics")
		return
	}

	common.SuccessResponse(c, metrics)
}

func (h *Handler) GetRideTypeStats(c *gin.Context) {
	startDate, endDate, err := parseDateRange(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	stats, err := h.service.GetRideTypeStats(c.Request.Context(), startDate, endDate)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get ride type stats")
		return
	}

	if stats == nil {
		stats = []*models.RideTypeStats{}
	}

	common.SuccessResponse(c, gin.H{
		"ride_types": stats,
	})
}

func (h *Handler) GetTopDrivers(c *gin.Context) {
	startDate, endDate, err := parseDateRange(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	limitStr := c.DefaultQuery("limit", "10")
	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit < 1 || limit > 100 {
		limit = 10
	}

	drivers, err := h.service.GetTopDrivers(c.Request.Context(), startDate, endDate, limit)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get top drivers")
		return
	}

	if drivers == nil {
		drivers = []*models.DriverPerformance{}
	}

	common.SuccessResponse(c, gin.H{
		"drivers": drivers,
	})
}

func (h *Handler) GetDashboardMetrics(c *gin.Context) {
	metrics, err := h.service.GetDashboardMetrics(c.Request.Context())
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get dashboard metrics")
		return
	}

	common.SuccessResponse(c, metrics)
}

func (h *Handler) HealthCheck(c *gin.Context) {
	common.SuccessResponse(c, gin.H{
		"service": "analytics",
		"status":  "healthy",
	})
}

func (h *Handler) GetDemandHeatMap(c *gin.Context) {
	startDate, endDate, err := parseDateRange(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	gridSizeStr := c.DefaultQuery("grid_size", "0.01")
	gridSize, err := strconv.ParseFloat(gridSizeStr, 64)
	if err != nil || gridSize <= 0 {
		gridSize = 0.01
	}

	heatMap, err := h.service.GetDemandHeatMap(c.Request.Context(), startDate, endDate, gridSize)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get demand heat map")
		return
	}

	if heatMap == nil {
		heatMap = []*models.DemandHeatMap{}
	}

	common.SuccessResponse(c, gin.H{
		"heat_map":     heatMap,
		"grid_size_km": gridSize * 111,
	})
}

func (h *Handler) GetFinancialReport(c *gin.Context) {
	startDate, endDate, err := parseDateRange(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	report, err := h.service.GetFinancialReport(c.Request.Context(), startDate, endDate)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get financial report")
		return
	}

	common.SuccessResponse(c, report)
}

func (h *Handler) GetDemandZones(c *gin.Context) {
	startDate, endDate, err := parseDateRange(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	minRidesStr := c.DefaultQuery("min_rides", "20")
	minRides, err := strconv.Atoi(minRidesStr)
	if err != nil || minRides < 1 {
		minRides = 20
	}

	zones, err := h.service.GetDemandZones(c.Request.Context(), startDate, endDate, minRides)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get demand zones")
		return
	}

	if zones == nil {
		zones = []*models.DemandZone{}
	}

	common.SuccessResponse(c, gin.H{
		"zones": zones,
	})
}

func (h *Handler) GetRevenueTimeSeries(c *gin.Context) {
	startDate, endDate, err := parseDateRange(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	granularity := c.DefaultQuery("granularity", "day")
	if granularity != "day" && granularity != "week" && granularity != "month" {
		granularity = "day"
	}

	data, err := h.service.GetRevenueTimeSeries(c.Request.Context(), startDate, endDate, granularity)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get revenue timeseries")
		return
	}

	if data == nil {
		data = []*models.RevenueTimeSeries{}
	}

	common.SuccessResponse(c, gin.H{
		"data":        data,
		"granularity": granularity,
	})
}

func (h *Handler) GetHourlyDistribution(c *gin.Context) {
	startDate, endDate, err := parseDateRange(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	data, err := h.service.GetHourlyDistribution(c.Request.Context(), startDate, endDate)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get hourly distribution")
		return
	}

	if data == nil {
		data = []*models.HourlyDistribution{}
	}

	common.SuccessResponse(c, gin.H{
		"data": data,
	})
}

func (h *Handler) GetDriverAnalytics(c *gin.Context) {
	startDate, endDate, err := parseDateRange(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	data, err := h.service.GetDriverAnalytics(c.Request.Context(), startDate, endDate)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get driver analytics")
		return
	}

	common.SuccessResponse(c, gin.H{
		"data": data,
	})
}

func (h *Handler) GetRiderGrowth(c *gin.Context) {
	startDate, endDate, err := parseDateRange(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	data, err := h.service.GetRiderGrowth(c.Request.Context(), startDate, endDate)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get rider growth")
		return
	}

	common.SuccessResponse(c, gin.H{
		"data": data,
	})
}

func (h *Handler) GetRideMetrics(c *gin.Context) {
	startDate, endDate, err := parseDateRange(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	data, err := h.service.GetRideMetrics(c.Request.Context(), startDate, endDate)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get ride metrics")
		return
	}

	common.SuccessResponse(c, gin.H{
		"data": data,
	})
}

func (h *Handler) GetTopDriversDetailed(c *gin.Context) {
	startDate, endDate, err := parseDateRange(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	limitStr := c.DefaultQuery("limit", "10")
	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit < 1 || limit > 100 {
		limit = 10
	}

	data, err := h.service.GetTopDriversDetailed(c.Request.Context(), startDate, endDate, limit)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get top drivers")
		return
	}

	if data == nil {
		data = []*models.TopDriver{}
	}

	common.SuccessResponse(c, gin.H{
		"data": data,
	})
}

func (h *Handler) GetPeriodComparison(c *gin.Context) {
	currentStartStr := c.Query("current_start")
	currentEndStr := c.Query("current_end")
	previousStartStr := c.Query("previous_start")
	previousEndStr := c.Query("previous_end")

	if currentStartStr == "" || currentEndStr == "" || previousStartStr == "" || previousEndStr == "" {
		common.ErrorResponse(c, http.StatusBadRequest, "all date parameters required: current_start, current_end, previous_start, previous_end")
		return
	}

	currentStart, err := time.Parse("2006-01-02", currentStartStr)
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid current_start date format")
		return
	}

	currentEnd, err := time.Parse("2006-01-02", currentEndStr)
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid current_end date format")
		return
	}
	currentEnd = currentEnd.Add(24 * time.Hour).Add(-time.Second)

	previousStart, err := time.Parse("2006-01-02", previousStartStr)
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid previous_start date format")
		return
	}

	previousEnd, err := time.Parse("2006-01-02", previousEndStr)
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid previous_end date format")
		return
	}
	previousEnd = previousEnd.Add(24 * time.Hour).Add(-time.Second)

	data, err := h.service.GetPeriodComparison(c.Request.Context(), currentStart, currentEnd, previousStart, previousEnd)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get period comparison")
		return
	}

	common.SuccessResponse(c, gin.H{
		"data": data,
	})
}

func parseDateRange(c *gin.Context) (time.Time, time.Time, error) {
	startDateStr := c.Query("start_date")
	endDateStr := c.Query("end_date")

	var startDate, endDate time.Time
	var err error

	if startDateStr == "" {
		startDate = time.Now().AddDate(0, 0, -30).Truncate(24 * time.Hour)
	} else {
		startDate, err = time.Parse("2006-01-02", startDateStr)
		if err != nil {
			return time.Time{}, time.Time{}, err
		}
	}

	if endDateStr == "" {
		endDate = time.Now()
	} else {
		endDate, err = time.Parse("2006-01-02", endDateStr)
		if err != nil {
			return time.Time{}, time.Time{}, err
		}
		endDate = endDate.Add(24 * time.Hour).Add(-time.Second)
	}

	return startDate, endDate, nil
}
