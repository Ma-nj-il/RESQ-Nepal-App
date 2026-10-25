package admin

import (
	"net/http"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/common"
	"github.com/bikky-kc013/medi-ambulance/pkg/pagination"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) GetDashboard(c *gin.Context) {
	stats, err := h.service.GetDashboardStats(c.Request.Context())
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to fetch dashboard stats")
		return
	}

	common.SuccessResponse(c, stats)
}

func (h *Handler) GetAllUsers(c *gin.Context) {
	params := pagination.ParseParams(c)

	filter := &UserFilter{}

	if role := c.Query("role"); role != "" {
		filter.Role = role
	}

	if status := c.Query("status"); status != "" {
		switch status {
		case "active":
			isActive := true
			filter.IsActive = &isActive
		case "inactive":
			isActive := false
			filter.IsActive = &isActive
		}
	}

	if search := c.Query("search"); search != "" {
		filter.Search = search
	}

	users, total, err := h.service.GetAllUsers(c.Request.Context(), params.Limit, params.Offset, filter)
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to fetch users")
		return
	}

	userStats, err := h.service.GetUserStats(c.Request.Context())
	if err != nil {
		userStats = nil
	}

	meta := pagination.BuildMeta(params.Limit, params.Offset, int64(total))
	meta.Stats = userStats
	common.SuccessResponseWithMeta(c, users, meta)
}

func (h *Handler) GetUser(c *gin.Context) {
	userID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid user ID")
		return
	}

	user, err := h.service.GetUser(c.Request.Context(), userID)
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusNotFound, "User not found")
		return
	}

	common.SuccessResponse(c, user)
}

func getAdminID(c *gin.Context) uuid.UUID {
	if id, ok := c.Get("user_id"); ok {
		if uid, ok := id.(uuid.UUID); ok {
			return uid
		}
	}
	return uuid.Nil
}

func (h *Handler) SuspendUser(c *gin.Context) {
	userID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid user ID")
		return
	}

	if err := h.service.SuspendUser(c.Request.Context(), getAdminID(c), userID); err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to suspend user")
		return
	}

	common.SuccessResponseWithStatus(c, http.StatusOK, nil, "User suspended successfully")
}

func (h *Handler) ActivateUser(c *gin.Context) {
	userID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid user ID")
		return
	}

	if err := h.service.ActivateUser(c.Request.Context(), getAdminID(c), userID); err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to activate user")
		return
	}

	common.SuccessResponseWithStatus(c, http.StatusOK, nil, "User activated successfully")
}

func (h *Handler) GetAllDrivers(c *gin.Context) {
	params := pagination.ParseParams(c)

	filter := &DriverFilter{}

	if status := c.Query("status"); status != "" {
		filter.Status = status
	}

	if search := c.Query("search"); search != "" {
		filter.Search = search
	}

	drivers, total, err := h.service.GetAllDrivers(c.Request.Context(), params.Limit, params.Offset, filter)
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to fetch drivers")
		return
	}

	driverStats, err := h.service.GetDriverStats(c.Request.Context())
	if err != nil {
		driverStats = nil
	}

	meta := pagination.BuildMeta(params.Limit, params.Offset, total)
	meta.Stats = driverStats
	common.SuccessResponseWithMeta(c, drivers, meta)
}

func (h *Handler) GetDriver(c *gin.Context) {
	driverID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid driver ID")
		return
	}

	driver, err := h.service.GetDriver(c.Request.Context(), driverID)
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusNotFound, "Driver not found")
		return
	}

	common.SuccessResponse(c, driver)
}

func (h *Handler) GetPendingDrivers(c *gin.Context) {
	params := pagination.ParseParams(c)

	drivers, total, err := h.service.GetPendingDrivers(c.Request.Context(), params.Limit, params.Offset)
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to fetch pending drivers")
		return
	}

	meta := pagination.BuildMeta(params.Limit, params.Offset, total)
	common.SuccessResponseWithMeta(c, drivers, meta)
}

func (h *Handler) ApproveDriver(c *gin.Context) {
	driverID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid driver ID")
		return
	}

	if err := h.service.ApproveDriver(c.Request.Context(), getAdminID(c), driverID); err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to approve driver")
		return
	}

	common.SuccessResponseWithStatus(c, http.StatusOK, nil, "Driver approved successfully")
}

func (h *Handler) RejectDriver(c *gin.Context) {
	driverID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid driver ID")
		return
	}

	if err := h.service.RejectDriver(c.Request.Context(), getAdminID(c), driverID); err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to reject driver")
		return
	}

	common.SuccessResponseWithStatus(c, http.StatusOK, nil, "Driver rejected successfully")
}

func (h *Handler) GetRideStats(c *gin.Context) {
	var startDate, endDate *time.Time

	if start := c.Query("start_date"); start != "" {
		t, err := time.Parse("2006-01-02", start)
		if err == nil {
			startDate = &t
		}
	}

	if end := c.Query("end_date"); end != "" {
		t, err := time.Parse("2006-01-02", end)
		if err == nil {
			endDate = &t
		}
	}

	stats, err := h.service.GetRideStats(c.Request.Context(), startDate, endDate)
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to fetch ride stats")
		return
	}

	common.SuccessResponse(c, stats)
}

func (h *Handler) GetRide(c *gin.Context) {
	rideID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid ride ID")
		return
	}

	ride, err := h.service.GetRide(c.Request.Context(), rideID)
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusNotFound, "Ride not found")
		return
	}

	common.SuccessResponse(c, ride)
}

func (h *Handler) GetRecentRides(c *gin.Context) {
	params := pagination.ParseParams(c)
	if c.Query("limit") == "" {
		params.Limit = 50
	}

	rides, total, err := h.service.GetRecentRides(c.Request.Context(), params.Limit, params.Offset)
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to fetch recent rides")
		return
	}

	meta := pagination.BuildMeta(params.Limit, params.Offset, total)
	common.SuccessResponseWithMeta(c, rides, meta)
}

func (h *Handler) HealthCheck(c *gin.Context) {
	healthData := gin.H{
		"status":  "healthy",
		"service": "admin",
	}
	common.SuccessResponse(c, healthData)
}

func (h *Handler) GetRealtimeMetrics(c *gin.Context) {
	metrics, err := h.service.GetRealtimeMetrics(c.Request.Context())
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to fetch realtime metrics")
		return
	}

	common.SuccessResponse(c, metrics)
}

func (h *Handler) GetDashboardSummary(c *gin.Context) {
	period := c.DefaultQuery("period", "today")

	summary, err := h.service.GetDashboardSummary(c.Request.Context(), period)
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to fetch dashboard summary")
		return
	}

	common.SuccessResponse(c, summary)
}

func (h *Handler) GetRevenueTrend(c *gin.Context) {
	period := c.DefaultQuery("period", "7days")
	groupBy := c.DefaultQuery("group_by", "day")

	trend, err := h.service.GetRevenueTrend(c.Request.Context(), period, groupBy)
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to fetch revenue trend")
		return
	}

	common.SuccessResponse(c, trend)
}

func (h *Handler) GetActionItems(c *gin.Context) {
	items, err := h.service.GetActionItems(c.Request.Context())
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to fetch action items")
		return
	}

	common.SuccessResponse(c, items)
}

func (h *Handler) GetAuditLogs(c *gin.Context) {
	params := pagination.ParseParams(c)
	if c.Query("limit") == "" {
		params.Limit = 50
	}

	filter := &AuditLogFilter{}

	if adminIDStr := c.Query("admin_id"); adminIDStr != "" {
		if id, err := uuid.Parse(adminIDStr); err == nil {
			filter.AdminID = &id
		}
	}
	if action := c.Query("action"); action != "" {
		filter.Action = action
	}
	if targetType := c.Query("target_type"); targetType != "" {
		filter.TargetType = targetType
	}
	if targetIDStr := c.Query("target_id"); targetIDStr != "" {
		if id, err := uuid.Parse(targetIDStr); err == nil {
			filter.TargetID = &id
		}
	}

	logs, total, err := h.service.GetAuditLogs(c.Request.Context(), params.Limit, params.Offset, filter)
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to fetch audit logs")
		return
	}

	meta := pagination.BuildMeta(params.Limit, params.Offset, total)
	common.SuccessResponseWithMeta(c, logs, meta)
}
