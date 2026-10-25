package waittime

import (
	"net/http"

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

func (h *Handler) StartWait(c *gin.Context) {
	driverID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req StartWaitRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid request body")
		return
	}

	record, err := h.service.StartWait(c.Request.Context(), driverID, &req)
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to start wait timer")
		return
	}

	common.CreatedResponse(c, record)
}

func (h *Handler) StopWait(c *gin.Context) {
	driverID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req StopWaitRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid request body")
		return
	}

	record, err := h.service.StopWait(c.Request.Context(), driverID, &req)
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to stop wait timer")
		return
	}

	common.SuccessResponse(c, record)
}

func (h *Handler) GetWaitTimeSummary(c *gin.Context) {
	rideID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid ride ID")
		return
	}

	summary, err := h.service.GetWaitTimeSummary(c.Request.Context(), rideID)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get wait time")
		return
	}

	common.SuccessResponse(c, summary)
}

func (h *Handler) GetCurrentWaitStatus(c *gin.Context) {
	rideID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid ride ID")
		return
	}

	record, err := h.service.GetCurrentWaitStatus(c.Request.Context(), rideID)
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusNotFound, "no active wait timer")
		return
	}

	common.SuccessResponse(c, record)
}

func (h *Handler) CreateConfig(c *gin.Context) {
	var req CreateConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid request body")
		return
	}

	config, err := h.service.CreateConfig(c.Request.Context(), &req)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to create config")
		return
	}

	common.CreatedResponse(c, config)
}

func (h *Handler) ListConfigs(c *gin.Context) {
	params := pagination.ParseParams(c)

	configs, err := h.service.ListConfigs(c.Request.Context())
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to list configs")
		return
	}

	meta := pagination.BuildMeta(params.Limit, params.Offset, int64(len(configs)))
	common.SuccessResponseWithMeta(c, configs, meta)
}

func (h *Handler) WaiveCharge(c *gin.Context) {
	var req WaiveChargeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := h.service.WaiveCharge(c.Request.Context(), req.RecordID); err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to waive charge")
		return
	}

	common.SuccessResponse(c, gin.H{"message": "Wait time charge waived"})
}

func (h *Handler) RegisterRoutes(r *gin.Engine, jwtProvider jwtkeys.KeyProvider) {
	driver := r.Group("/api/v1/driver/wait")
	driver.Use(middleware.AuthMiddlewareWithProvider(jwtProvider))
	driver.Use(middleware.RequireRole(models.RoleDriver))
	{
		driver.POST("/start", h.StartWait)
		driver.POST("/stop", h.StopWait)
	}

	rides := r.Group("/api/v1/rides")
	rides.Use(middleware.AuthMiddlewareWithProvider(jwtProvider))
	{
		rides.GET("/:id/wait-time", h.GetWaitTimeSummary)
		rides.GET("/:id/wait-time/current", h.GetCurrentWaitStatus)
	}

	admin := r.Group("/api/v1/admin/wait-time")
	admin.Use(middleware.AuthMiddlewareWithProvider(jwtProvider))
	admin.Use(middleware.RequireRole(models.RoleAdmin))
	{
		admin.POST("/configs", h.CreateConfig)
		admin.GET("/configs", h.ListConfigs)
		admin.POST("/waive", h.WaiveCharge)
	}
}
