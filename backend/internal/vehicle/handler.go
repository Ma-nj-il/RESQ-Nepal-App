package vehicle

import (
	"net/http"
	"strconv"

	"github.com/bikky-kc013/medi-ambulance/pkg/common"
	"github.com/bikky-kc013/medi-ambulance/pkg/jwtkeys"
	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	"github.com/bikky-kc013/medi-ambulance/pkg/middleware"
	"github.com/bikky-kc013/medi-ambulance/pkg/models"
	"github.com/bikky-kc013/medi-ambulance/pkg/pagination"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) Register(c *gin.Context) {
	driverID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}
	logger.Info(
		"Registering vehicle for driver",
		zap.String("driver_id", driverID.String()),
	)

	var req RegisterVehicleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid request body")
		return
	}

	vehicle, err := h.service.RegisterVehicle(c.Request.Context(), driverID, &req)
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to register vehicle")
		return
	}

	common.CreatedResponse(c, vehicle)
}

func (h *Handler) GetMyVehicles(c *gin.Context) {
	driverID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	resp, err := h.service.GetMyVehicles(c.Request.Context(), driverID)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get vehicles")
		return
	}

	common.SuccessResponse(c, resp)
}

func (h *Handler) GetVehicle(c *gin.Context) {
	driverID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	vehicleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid vehicle id")
		return
	}

	vehicle, err := h.service.GetVehicle(c.Request.Context(), vehicleID, driverID)
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get vehicle")
		return
	}

	common.SuccessResponse(c, vehicle)
}

func (h *Handler) GetAllVehicles(c *gin.Context) {
	_, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	vehicles, err := h.service.GetAllVehicles(c.Request.Context())
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get vehicle")
		return
	}

	common.SuccessResponse(c, vehicles)
}

func (h *Handler) UpdateVehicle(c *gin.Context) {
	driverID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	vehicleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid vehicle id")
		return
	}

	var req UpdateVehicleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid request body")
		return
	}

	vehicle, err := h.service.UpdateVehicle(c.Request.Context(), vehicleID, driverID, &req)
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to update vehicle")
		return
	}

	common.SuccessResponse(c, vehicle)
}

func (h *Handler) UploadPhotos(c *gin.Context) {
	driverID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	vehicleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid vehicle id")
		return
	}

	var req UploadVehiclePhotosRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := h.service.UploadPhotos(c.Request.Context(), vehicleID, driverID, &req); err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to upload photos")
		return
	}

	common.SuccessResponse(c, gin.H{"message": "photos uploaded"})
}

func (h *Handler) SetPrimary(c *gin.Context) {
	driverID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	vehicleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid vehicle id")
		return
	}

	if err := h.service.SetPrimary(c.Request.Context(), vehicleID, driverID); err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to set primary vehicle")
		return
	}

	common.SuccessResponse(c, gin.H{"message": "primary vehicle set"})
}

func (h *Handler) Retire(c *gin.Context) {
	driverID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	vehicleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid vehicle id")
		return
	}

	if err := h.service.RetireVehicle(c.Request.Context(), vehicleID, driverID); err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to retire vehicle")
		return
	}

	common.SuccessResponse(c, gin.H{"message": "vehicle retired"})
}

func (h *Handler) GetMaintenanceReminders(c *gin.Context) {
	driverID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	vehicleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid vehicle id")
		return
	}

	reminders, err := h.service.GetMaintenanceReminders(c.Request.Context(), vehicleID, driverID)
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get reminders")
		return
	}

	common.SuccessResponse(c, gin.H{"reminders": reminders})
}

func (h *Handler) CompleteMaintenance(c *gin.Context) {
	reminderID, err := uuid.Parse(c.Param("reminderId"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid reminder id")
		return
	}

	if err := h.service.CompleteMaintenance(c.Request.Context(), reminderID); err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to complete maintenance")
		return
	}

	common.SuccessResponse(c, gin.H{"message": "maintenance completed"})
}

func (h *Handler) GetInspections(c *gin.Context) {
	driverID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	vehicleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid vehicle id")
		return
	}

	inspections, err := h.service.GetInspections(c.Request.Context(), vehicleID, driverID)
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get inspections")
		return
	}

	common.SuccessResponse(c, gin.H{"inspections": inspections})
}

func (h *Handler) AdminReview(c *gin.Context) {
	vehicleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid vehicle id")
		return
	}

	var req AdminReviewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := h.service.ReviewVehicle(c.Request.Context(), vehicleID, &req); err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to review vehicle")
		return
	}

	common.SuccessResponse(c, gin.H{"message": "vehicle reviewed"})
}

func (h *Handler) AdminGetPending(c *gin.Context) {
	params := pagination.ParseParams(c)

	vehicles, total, err := h.service.GetPendingReviews(c.Request.Context(), params.Limit, params.Offset)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get pending vehicles")
		return
	}
	if vehicles == nil {
		vehicles = []Vehicle{}
	}

	meta := pagination.BuildMeta(params.Limit, params.Offset, int64(total))
	common.SuccessResponseWithMeta(c, gin.H{
		"vehicles": vehicles,
	}, meta)
}

func (h *Handler) AdminGetStats(c *gin.Context) {
	stats, err := h.service.GetVehicleStats(c.Request.Context())
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get vehicle stats")
		return
	}

	common.SuccessResponse(c, stats)
}

func (h *Handler) AdminSuspend(c *gin.Context) {
	vehicleID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid vehicle id")
		return
	}

	var req struct {
		Reason string `json:"reason" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "reason is required")
		return
	}

	if err := h.service.SuspendVehicle(c.Request.Context(), vehicleID, req.Reason); err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to suspend vehicle")
		return
	}

	common.SuccessResponse(c, gin.H{"message": "vehicle suspended"})
}

func (h *Handler) AdminGetExpiring(c *gin.Context) {
	days, _ := strconv.Atoi(c.DefaultQuery("days", "30"))

	vehicles, err := h.service.GetExpiringDocuments(c.Request.Context(), days)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get expiring vehicles")
		return
	}

	common.SuccessResponse(c, gin.H{
		"vehicles": vehicles,
		"count":    len(vehicles),
		"days":     days,
	})
}

func (h *Handler) RegisterRoutes(r *gin.Engine, jwtProvider jwtkeys.KeyProvider) {
	driver := r.Group("/api/v1/driver/vehicles")
	driver.Use(middleware.AuthMiddlewareWithProvider(jwtProvider))
	driver.Use(middleware.RequireRole(models.RoleDriver))
	{
		driver.POST("", h.Register)
		driver.GET("", h.GetMyVehicles)
		driver.GET("/:id", h.GetVehicle)
		driver.PUT("/:id", h.UpdateVehicle)
		driver.POST("/:id/photos", h.UploadPhotos)
		driver.POST("/:id/primary", h.SetPrimary)
		driver.POST("/:id/retire", h.Retire)
		driver.GET("/:id/maintenance", h.GetMaintenanceReminders)
		driver.POST("/maintenance/:reminderId/complete", h.CompleteMaintenance)
		driver.GET("/:id/inspections", h.GetInspections)
	}

	admin := r.Group("/api/v1/admin/vehicles")
	admin.Use(middleware.AuthMiddlewareWithProvider(jwtProvider))
	admin.Use(middleware.RequireRole(models.RoleAdmin))
	{
		admin.GET("", h.GetAllVehicles)
		admin.GET("/pending", h.AdminGetPending)
		admin.GET("/stats", h.AdminGetStats)
		admin.GET("/expiring", h.AdminGetExpiring)
		admin.POST("/:id/review", h.AdminReview)
		admin.POST("/:id/suspend", h.AdminSuspend)
	}
}

func (h *Handler) RegisterAdminRoutes(rg *gin.RouterGroup) {
	vehicles := rg.Group("/vehicles")
	{
		vehicles.GET("", h.GetAllVehicles)
		vehicles.GET("/pending", h.AdminGetPending)
		vehicles.GET("/stats", h.AdminGetStats)
		vehicles.GET("/expiring", h.AdminGetExpiring)
		vehicles.POST("/:id/review", h.AdminReview)
		vehicles.POST("/:id/suspend", h.AdminSuspend)
	}
}
