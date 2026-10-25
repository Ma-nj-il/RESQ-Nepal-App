package disputes

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

func (h *Handler) CreateDispute(c *gin.Context) {
	userID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req CreateDisputeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid request body")
		return
	}

	dispute, err := h.service.CreateDispute(c.Request.Context(), userID, &req)
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to create dispute")
		return
	}

	common.CreatedResponse(c, dispute)
}

func (h *Handler) GetMyDisputes(c *gin.Context) {
	userID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	params := pagination.ParseParams(c)

	var status *DisputeStatus
	if s := c.Query("status"); s != "" {
		st := DisputeStatus(s)
		status = &st
	}

	disputes, total, err := h.service.GetMyDisputes(c.Request.Context(), userID, status, params.Limit, params.Offset)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get disputes")
		return
	}

	meta := pagination.BuildMeta(params.Limit, params.Offset, int64(total))
	common.SuccessResponseWithMeta(c, gin.H{
		"disputes": disputes,
	}, meta)
}

func (h *Handler) GetDisputeDetail(c *gin.Context) {
	userID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	disputeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid dispute id")
		return
	}

	detail, err := h.service.GetDisputeDetail(c.Request.Context(), disputeID, userID)
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get dispute")
		return
	}

	common.SuccessResponse(c, detail)
}

func (h *Handler) AddComment(c *gin.Context) {
	userID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	disputeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid dispute id")
		return
	}

	var req AddCommentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid request body")
		return
	}

	comment, err := h.service.AddComment(c.Request.Context(), disputeID, userID, &req)
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to add comment")
		return
	}

	common.CreatedResponse(c, comment)
}

func (h *Handler) GetDisputeReasons(c *gin.Context) {
	reasons := h.service.GetDisputeReasons()
	common.SuccessResponse(c, reasons)
}

func (h *Handler) AdminGetDisputes(c *gin.Context) {
	params := pagination.ParseParams(c)

	var status *DisputeStatus
	if s := c.Query("status"); s != "" {
		st := DisputeStatus(s)
		status = &st
	}
	var reason *DisputeReason
	if r := c.Query("reason"); r != "" {
		dr := DisputeReason(r)
		reason = &dr
	}

	disputes, total, err := h.service.AdminGetDisputes(c.Request.Context(), status, reason, params.Limit, params.Offset)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get disputes")
		return
	}

	meta := pagination.BuildMeta(params.Limit, params.Offset, int64(total))
	common.SuccessResponseWithMeta(c, gin.H{
		"disputes": disputes,
	}, meta)
}

func (h *Handler) AdminGetDisputeDetail(c *gin.Context) {
	disputeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid dispute id")
		return
	}

	detail, err := h.service.AdminGetDisputeDetail(c.Request.Context(), disputeID)
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get dispute")
		return
	}

	common.SuccessResponse(c, detail)
}

func (h *Handler) AdminResolveDispute(c *gin.Context) {
	adminID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	disputeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid dispute id")
		return
	}

	var req ResolveDisputeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := h.service.AdminResolveDispute(c.Request.Context(), disputeID, adminID, &req); err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to resolve dispute")
		return
	}

	common.SuccessResponse(c, gin.H{"message": "dispute resolved"})
}

func (h *Handler) AdminAddComment(c *gin.Context) {
	adminID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	disputeID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid dispute id")
		return
	}

	var req struct {
		Comment    string `json:"comment" binding:"required"`
		IsInternal bool   `json:"is_internal"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid request body")
		return
	}

	comment, err := h.service.AdminAddComment(c.Request.Context(), disputeID, adminID, req.Comment, req.IsInternal)
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to add comment")
		return
	}

	common.CreatedResponse(c, comment)
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

	stats, err := h.service.AdminGetStats(c.Request.Context(), from, to)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get dispute stats")
		return
	}

	common.SuccessResponse(c, stats)
}

func (h *Handler) RegisterRoutes(r *gin.Engine, jwtProvider jwtkeys.KeyProvider) {
	disputes := r.Group("/api/v1/disputes")
	disputes.Use(middleware.AuthMiddlewareWithProvider(jwtProvider))
	{
		disputes.POST("", h.CreateDispute)
		disputes.GET("", h.GetMyDisputes)
		disputes.GET("/reasons", h.GetDisputeReasons)
		disputes.GET("/:id", h.GetDisputeDetail)
		disputes.POST("/:id/comments", h.AddComment)
	}

	admin := r.Group("/api/v1/admin/disputes")
	admin.Use(middleware.AuthMiddlewareWithProvider(jwtProvider))
	admin.Use(middleware.RequireRole(models.RoleAdmin))
	{
		admin.GET("", h.AdminGetDisputes)
		admin.GET("/stats", h.AdminGetStats)
		admin.GET("/:id", h.AdminGetDisputeDetail)
		admin.POST("/:id/resolve", h.AdminResolveDispute)
		admin.POST("/:id/comments", h.AdminAddComment)
	}
}

func (h *Handler) RegisterAdminRoutes(rg *gin.RouterGroup) {
	disputes := rg.Group("/disputes")
	{
		disputes.GET("", h.AdminGetDisputes)
		disputes.GET("/stats", h.AdminGetStats)
		disputes.GET("/:id", h.AdminGetDisputeDetail)
		disputes.POST("/:id/resolve", h.AdminResolveDispute)
		disputes.POST("/:id/comments", h.AdminAddComment)
	}
}
