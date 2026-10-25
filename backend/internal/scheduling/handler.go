package scheduling

import (
	"io"
	"net/http"
	"strconv"

	"github.com/bikky-kc013/medi-ambulance/pkg/common"
	"github.com/bikky-kc013/medi-ambulance/pkg/jwtkeys"
	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	"github.com/bikky-kc013/medi-ambulance/pkg/middleware"
	"github.com/bikky-kc013/medi-ambulance/pkg/pagination"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

// Handler handles HTTP requests for scheduling
type Handler struct {
	service *Service
}

// NewHandler creates a new scheduling handler
func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

// ========================================
// RECURRING RIDE ENDPOINTS
// ========================================

// CreateRecurringRide creates a new recurring ride
// POST /api/v1/scheduling/recurring-rides
func (h *Handler) CreateRecurringRide(c *gin.Context) {
	riderID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req CreateRecurringRideRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid request body")
		return
	}

	response, err := h.service.CreateRecurringRide(c.Request.Context(), riderID, &req)
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to create recurring ride")
		return
	}

	common.SuccessResponse(c, response)
}

// GetRecurringRide gets a recurring ride with upcoming instances
// GET /api/v1/scheduling/recurring-rides/:id
func (h *Handler) GetRecurringRide(c *gin.Context) {
	riderID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	rideID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid ride ID")
		return
	}

	response, err := h.service.GetRecurringRide(c.Request.Context(), riderID, rideID)
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusNotFound, "recurring ride not found")
		return
	}

	common.SuccessResponse(c, response)
}

// ListRecurringRides lists all recurring rides for the authenticated rider
// GET /api/v1/scheduling/recurring-rides
func (h *Handler) ListRecurringRides(c *gin.Context) {
	riderID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	params := pagination.ParseParams(c)

	rides, err := h.service.ListRecurringRides(c.Request.Context(), riderID)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to list recurring rides")
		return
	}

	meta := pagination.BuildMeta(params.Limit, params.Offset, int64(len(rides)))
	common.SuccessResponseWithMeta(c, rides, meta)
}

// UpdateRecurringRide updates a recurring ride
// PUT /api/v1/scheduling/recurring-rides/:id
func (h *Handler) UpdateRecurringRide(c *gin.Context) {
	riderID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	rideID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid ride ID")
		return
	}

	var req UpdateRecurringRideRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := h.service.UpdateRecurringRide(c.Request.Context(), riderID, rideID, &req); err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to update recurring ride")
		return
	}

	common.SuccessResponse(c, gin.H{
		"message": "Recurring ride updated successfully",
	})
}

// PauseRecurringRide pauses a recurring ride
// POST /api/v1/scheduling/recurring-rides/:id/pause
func (h *Handler) PauseRecurringRide(c *gin.Context) {
	riderID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	rideID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid ride ID")
		return
	}

	if err := h.service.PauseRecurringRide(c.Request.Context(), riderID, rideID); err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to pause recurring ride")
		return
	}

	common.SuccessResponse(c, gin.H{
		"message": "Recurring ride paused successfully",
	})
}

// ResumeRecurringRide resumes a paused recurring ride
// POST /api/v1/scheduling/recurring-rides/:id/resume
func (h *Handler) ResumeRecurringRide(c *gin.Context) {
	riderID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	rideID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid ride ID")
		return
	}

	if err := h.service.ResumeRecurringRide(c.Request.Context(), riderID, rideID); err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to resume recurring ride")
		return
	}

	common.SuccessResponse(c, gin.H{
		"message": "Recurring ride resumed successfully",
	})
}

// CancelRecurringRide cancels a recurring ride
// DELETE /api/v1/scheduling/recurring-rides/:id
func (h *Handler) CancelRecurringRide(c *gin.Context) {
	riderID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	rideID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid ride ID")
		return
	}

	if err := h.service.CancelRecurringRide(c.Request.Context(), riderID, rideID); err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to cancel recurring ride")
		return
	}

	common.SuccessResponse(c, gin.H{
		"message": "Recurring ride cancelled successfully",
	})
}

// ========================================
// INSTANCE ENDPOINTS
// ========================================

// GetUpcomingInstances gets upcoming ride instances for the authenticated rider
// GET /api/v1/scheduling/instances
func (h *Handler) GetUpcomingInstances(c *gin.Context) {
	riderID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	days, _ := strconv.Atoi(c.DefaultQuery("days", "7"))
	if days < 1 || days > 30 {
		days = 7
	}

	instances, err := h.service.GetUpcomingInstances(c.Request.Context(), riderID, days)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get upcoming instances")
		return
	}

	common.SuccessResponse(c, gin.H{
		"instances": instances,
		"count":     len(instances),
	})
}

// SkipInstance skips a scheduled instance
// POST /api/v1/scheduling/instances/:id/skip
func (h *Handler) SkipInstance(c *gin.Context) {
	riderID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	instanceID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid instance ID")
		return
	}

	var req SkipInstanceRequest
	// Reason field is optional - only log non-EOF parse errors
	if err := c.ShouldBindJSON(&req); err != nil && err != io.EOF {
		logger.Get().Debug("Failed to parse optional skip reason", zap.Error(err))
		req.Reason = ""
	}

	if err := h.service.SkipInstance(c.Request.Context(), riderID, instanceID, req.Reason); err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to skip instance")
		return
	}

	common.SuccessResponse(c, gin.H{
		"message": "Instance skipped successfully",
	})
}

// RescheduleInstance reschedules an instance to a new date/time
// POST /api/v1/scheduling/instances/:id/reschedule
func (h *Handler) RescheduleInstance(c *gin.Context) {
	riderID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	instanceID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid instance ID")
		return
	}

	var req RescheduleInstanceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := h.service.RescheduleInstance(c.Request.Context(), riderID, instanceID, &req); err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to reschedule instance")
		return
	}

	common.SuccessResponse(c, gin.H{
		"message": "Instance rescheduled successfully",
	})
}

// ========================================
// PREVIEW ENDPOINT
// ========================================

// PreviewSchedule previews upcoming dates for a schedule configuration
// POST /api/v1/scheduling/preview
func (h *Handler) PreviewSchedule(c *gin.Context) {
	var req SchedulePreviewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid request body")
		return
	}

	preview, err := h.service.PreviewSchedule(c.Request.Context(), &req)
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to generate preview")
		return
	}

	common.SuccessResponse(c, preview)
}

// ========================================
// STATS ENDPOINT
// ========================================

// GetStats gets scheduling statistics for the authenticated rider
// GET /api/v1/scheduling/stats
func (h *Handler) GetStats(c *gin.Context) {
	riderID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	stats, err := h.service.GetRiderStats(c.Request.Context(), riderID)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get stats")
		return
	}

	common.SuccessResponse(c, stats)
}

// ========================================
// ROUTE REGISTRATION
// ========================================

// RegisterRoutes registers scheduling routes
func (h *Handler) RegisterRoutes(r *gin.Engine, jwtProvider jwtkeys.KeyProvider) {
	// All scheduling routes require authentication
	scheduling := r.Group("/api/v1/scheduling")
	scheduling.Use(middleware.AuthMiddlewareWithProvider(jwtProvider))
	{
		// Recurring rides
		scheduling.POST("/recurring-rides", h.CreateRecurringRide)
		scheduling.GET("/recurring-rides", h.ListRecurringRides)
		scheduling.GET("/recurring-rides/:id", h.GetRecurringRide)
		scheduling.PUT("/recurring-rides/:id", h.UpdateRecurringRide)
		scheduling.DELETE("/recurring-rides/:id", h.CancelRecurringRide)
		scheduling.POST("/recurring-rides/:id/pause", h.PauseRecurringRide)
		scheduling.POST("/recurring-rides/:id/resume", h.ResumeRecurringRide)

		// Instances
		scheduling.GET("/instances", h.GetUpcomingInstances)
		scheduling.POST("/instances/:id/skip", h.SkipInstance)
		scheduling.POST("/instances/:id/reschedule", h.RescheduleInstance)

		// Preview
		scheduling.POST("/preview", h.PreviewSchedule)

		// Stats
		scheduling.GET("/stats", h.GetStats)
	}
}
