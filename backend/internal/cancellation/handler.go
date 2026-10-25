package cancellation

import (
	"net/http"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/common"
	"github.com/bikky-kc013/medi-ambulance/pkg/jwtkeys"
	"github.com/bikky-kc013/medi-ambulance/pkg/middleware"
	"github.com/bikky-kc013/medi-ambulance/pkg/models"
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

func (h *Handler) PreviewCancellation(c *gin.Context) {
	userID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	rideID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid ride id")
		return
	}

	preview, err := h.service.PreviewCancellation(c.Request.Context(), rideID, userID)
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to preview cancellation")
		return
	}

	common.SuccessResponse(c, preview)
}

func (h *Handler) CancelRide(c *gin.Context) {
	userID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	rideID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid ride id")
		return
	}

	var req CancelRideRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid request body")
		return
	}

	resp, err := h.service.CancelRide(c.Request.Context(), rideID, userID, &req)
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to cancel ride")
		return
	}

	common.SuccessResponse(c, resp)
}

func (h *Handler) GetCancellationDetails(c *gin.Context) {
	userID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	rideID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid ride id")
		return
	}

	rec, err := h.service.GetCancellationDetails(c.Request.Context(), rideID, userID)
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get cancellation details")
		return
	}

	common.SuccessResponse(c, rec)
}

func (h *Handler) GetMyCancellationStats(c *gin.Context) {
	userID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	stats, err := h.service.GetMyCancellationStats(c.Request.Context(), userID)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get cancellation stats")
		return
	}

	common.SuccessResponse(c, stats)
}

func (h *Handler) GetMyCancellationHistory(c *gin.Context) {
	userID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	params := pagination.ParseParams(c)

	records, total, err := h.service.GetMyCancellationHistory(c.Request.Context(), userID, params.Limit, params.Offset)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get cancellation history")
		return
	}

	meta := pagination.BuildMeta(params.Limit, params.Offset, int64(total))
	common.SuccessResponseWithMeta(c, gin.H{
		"cancellations": records,
	}, meta)
}

func (h *Handler) GetCancellationReasons(c *gin.Context) {
	userType := c.DefaultQuery("type", "rider")
	isDriver := userType == "driver"
	reasons := h.service.GetCancellationReasons(isDriver)
	common.SuccessResponse(c, reasons)
}

func (h *Handler) AdminWaiveFee(c *gin.Context) {
	cancellationID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid cancellation id")
		return
	}

	var req WaiveFeeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := h.service.WaiveFee(c.Request.Context(), cancellationID, req.Reason); err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to waive fee")
		return
	}

	common.SuccessResponse(c, gin.H{"message": "cancellation fee waived"})
}

func (h *Handler) AdminGetStats(c *gin.Context) {
	from := time.Now().AddDate(0, -1, 0)
	to := time.Now()

	if fromStr := c.Query("from"); fromStr != "" {
		if t, err := time.Parse("2006-01-02", fromStr); err == nil {
			from = t
		}
	}
	if toStr := c.Query("to"); toStr != "" {
		if t, err := time.Parse("2006-01-02", toStr); err == nil {
			to = t.AddDate(0, 0, 1)
		}
	}

	stats, err := h.service.GetCancellationStats(c.Request.Context(), from, to)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get cancellation stats")
		return
	}

	common.SuccessResponse(c, stats)
}

func (h *Handler) AdminGetUserStats(c *gin.Context) {
	userID, err := uuid.Parse(c.Param("userId"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid user id")
		return
	}

	stats, err := h.service.GetUserCancellationStats(c.Request.Context(), userID)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get user cancellation stats")
		return
	}

	common.SuccessResponse(c, stats)
}

func (h *Handler) RegisterRoutes(r *gin.Engine, jwtProvider jwtkeys.KeyProvider) {
	rides := r.Group("/api/v1/rides")
	rides.Use(middleware.AuthMiddlewareWithProvider(jwtProvider))
	{
		rides.GET("/:id/cancel/preview", h.PreviewCancellation)
		rides.POST("/:id/cancel", h.CancelRide)
		rides.GET("/:id/cancellation", h.GetCancellationDetails)
	}

	cancellations := r.Group("/api/v1/cancellations")
	cancellations.Use(middleware.AuthMiddlewareWithProvider(jwtProvider))
	{
		cancellations.GET("/stats", h.GetMyCancellationStats)
		cancellations.GET("/history", h.GetMyCancellationHistory)
		cancellations.GET("/reasons", h.GetCancellationReasons)
	}

	admin := r.Group("/api/v1/admin/cancellations")
	admin.Use(middleware.AuthMiddlewareWithProvider(jwtProvider))
	admin.Use(middleware.RequireRole(models.RoleAdmin))
	{
		admin.POST("/:id/waive", h.AdminWaiveFee)
		admin.GET("/stats", h.AdminGetStats)
		admin.GET("/users/:userId/stats", h.AdminGetUserStats)
	}
}

func (h *Handler) RegisterAdminRoutes(rg *gin.RouterGroup) {
	cancellations := rg.Group("/cancellations")
	{
		cancellations.GET("/stats", h.AdminGetStats)
		cancellations.POST("/:id/waive", h.AdminWaiveFee)
		cancellations.GET("/users/:userId/stats", h.AdminGetUserStats)
	}
}
