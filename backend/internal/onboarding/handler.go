package onboarding

import (
	"net/http"

	"github.com/bikky-kc013/medi-ambulance/pkg/common"
	"github.com/bikky-kc013/medi-ambulance/pkg/jwtkeys"
	"github.com/bikky-kc013/medi-ambulance/pkg/middleware"
	"github.com/bikky-kc013/medi-ambulance/pkg/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) GetProgress(c *gin.Context) {
	driverID, err := h.getDriverID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "not a registered driver")
		return
	}

	progress, err := h.service.GetOnboardingProgress(c.Request.Context(), driverID)
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get onboarding progress")
		return
	}

	common.SuccessResponse(c, progress)
}

func (h *Handler) StartOnboarding(c *gin.Context) {
	userID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	progress, err := h.service.StartOnboarding(c.Request.Context(), userID)
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to start onboarding")
		return
	}

	common.SuccessResponse(c, progress)
}

func (h *Handler) GetDocumentRequirements(c *gin.Context) {
	driverID, err := h.getDriverID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "not a registered driver")
		return
	}

	requirements, err := h.service.GetDocumentRequirements(c.Request.Context(), driverID)
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get document requirements")
		return
	}

	common.SuccessResponse(c, gin.H{
		"requirements": requirements,
	})
}

func (h *Handler) GetOnboardingStats(c *gin.Context) {
	stats, err := h.service.repo.GetOnboardingStats(c.Request.Context())
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get onboarding stats")
		return
	}

	common.SuccessResponse(c, stats)
}

func (h *Handler) getDriverID(c *gin.Context) (uuid.UUID, error) {
	userID, err := middleware.GetUserID(c)
	if err != nil {
		return uuid.Nil, err
	}

	driver, err := h.service.repo.GetDriverByUserID(c.Request.Context(), userID)
	if err != nil {
		return uuid.Nil, err
	}

	return driver.ID, nil
}

func (h *Handler) RegisterRoutes(r *gin.Engine, jwtProvider jwtkeys.KeyProvider) {
	onboarding := r.Group("/api/v1/driver/onboarding")
	onboarding.Use(middleware.AuthMiddlewareWithProvider(jwtProvider))
	{
		onboarding.POST("/start", h.StartOnboarding)
		onboarding.GET("/progress", h.GetProgress)
		onboarding.GET("/documents", h.GetDocumentRequirements)
	}

	adminOnboarding := r.Group("/api/v1/admin/onboarding")
	adminOnboarding.Use(middleware.AuthMiddlewareWithProvider(jwtProvider))
	adminOnboarding.Use(middleware.RequireRole(models.RoleAdmin))
	{
		adminOnboarding.GET("/stats", h.GetOnboardingStats)
	}
}

func (h *Handler) RegisterRoutesOnGroup(rg *gin.RouterGroup) {
	onboarding := rg.Group("/driver/onboarding")
	{
		onboarding.POST("/start", h.StartOnboarding)
		onboarding.GET("/progress", h.GetProgress)
		onboarding.GET("/documents", h.GetDocumentRequirements)
	}
}
