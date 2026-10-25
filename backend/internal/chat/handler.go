package chat

import (
	"net/http"

	"github.com/bikky-kc013/medi-ambulance/pkg/common"
	"github.com/bikky-kc013/medi-ambulance/pkg/jwtkeys"
	"github.com/bikky-kc013/medi-ambulance/pkg/middleware"
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

func (h *Handler) SendMessage(c *gin.Context) {
	userID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	role, err := middleware.GetUserRole(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req SendMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid request body")
		return
	}

	msg, err := h.service.SendMessage(c.Request.Context(), userID, string(role), &req)
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to send message")
		return
	}

	common.CreatedResponse(c, msg)
}

func (h *Handler) GetConversation(c *gin.Context) {
	userID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	rideID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid ride ID")
		return
	}

	params := pagination.ParseParams(c)

	conversation, err := h.service.GetConversation(c.Request.Context(), userID, rideID, params.Limit, params.Offset)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get conversation")
		return
	}

	common.SuccessResponse(c, conversation)
}

func (h *Handler) MarkAsRead(c *gin.Context) {
	userID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req MarkReadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := h.service.MarkAsRead(c.Request.Context(), userID, &req); err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to mark as read")
		return
	}

	common.SuccessResponse(c, gin.H{"message": "Messages marked as read"})
}

func (h *Handler) GetActiveConversations(c *gin.Context) {
	userID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	rideIDs, err := h.service.GetActiveConversations(c.Request.Context(), userID)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get conversations")
		return
	}

	if rideIDs == nil {
		rideIDs = []uuid.UUID{}
	}

	common.SuccessResponse(c, gin.H{
		"ride_ids": rideIDs,
		"count":    len(rideIDs),
	})
}

func (h *Handler) GetQuickReplies(c *gin.Context) {
	role, err := middleware.GetUserRole(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	replies, err := h.service.GetQuickReplies(c.Request.Context(), string(role))
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get quick replies")
		return
	}

	common.SuccessResponse(c, gin.H{
		"quick_replies": replies,
		"count":         len(replies),
	})
}

func (h *Handler) RegisterRoutes(r *gin.Engine, jwtProvider jwtkeys.KeyProvider) {
	chat := r.Group("/api/v1/chat")
	chat.Use(middleware.AuthMiddlewareWithProvider(jwtProvider))
	{
		chat.POST("/messages", h.SendMessage)
		chat.GET("/rides/:id/messages", h.GetConversation)
		chat.POST("/read", h.MarkAsRead)
		chat.GET("/conversations", h.GetActiveConversations)
		chat.GET("/quick-replies", h.GetQuickReplies)
	}
}
