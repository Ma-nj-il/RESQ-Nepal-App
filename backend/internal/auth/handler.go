package auth

import (
	"errors"
	"net/http"

	"github.com/bikky-kc013/medi-ambulance/pkg/common"
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

func (h *Handler) RequireActiveSession() gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, sessionID, err := authIDs(c)
		if err != nil {
			respondError(c, invalidSessionError(), "authorization failed")
			c.Abort()
			return
		}
		if err := h.service.ValidateActiveSession(c.Request.Context(), userID, sessionID); err != nil {
			respondError(c, err, "authorization failed")
			c.Abort()
			return
		}
		c.Next()
	}
}

func (h *Handler) Register(c *gin.Context) {
	var req models.RegisterRequest
	if !bindJSON(c, &req) {
		return
	}
	user, err := h.service.Register(c.Request.Context(), &req, requestClient(c))
	if err != nil {
		respondError(c, err, "registration failed")
		return
	}
	common.CreatedResponse(c, user)
}

func (h *Handler) Login(c *gin.Context) {
	var req models.LoginRequest
	if !bindJSON(c, &req) {
		return
	}
	response, err := h.service.Login(c.Request.Context(), &req, requestClient(c))
	if err != nil {
		respondError(c, err, "login failed")
		return
	}
	common.SuccessResponse(c, response)
}

func (h *Handler) Refresh(c *gin.Context) {
	var req RefreshTokenRequest
	if !bindJSON(c, &req) {
		return
	}
	response, err := h.service.Refresh(c.Request.Context(), &req, requestClient(c))
	if err != nil {
		respondError(c, err, "token refresh failed")
		return
	}
	common.SuccessResponse(c, response)
}

func (h *Handler) Logout(c *gin.Context) {
	userID, sessionID, ok := requireAuthIDs(c)
	if !ok {
		return
	}
	if err := h.service.Logout(c.Request.Context(), userID, sessionID, requestClient(c)); err != nil {
		respondError(c, err, "logout failed")
		return
	}
	common.SuccessResponse(c, MessageResponse{Message: "logged out"})
}

func (h *Handler) ListSessions(c *gin.Context) {
	userID, sessionID, ok := requireAuthIDs(c)
	if !ok {
		return
	}
	sessions, err := h.service.ListSessions(c.Request.Context(), userID, sessionID)
	if err != nil {
		respondError(c, err, "failed to list sessions")
		return
	}
	common.SuccessResponse(c, sessions)
}

func (h *Handler) RevokeSession(c *gin.Context) {
	userID, currentSessionID, ok := requireAuthIDs(c)
	if !ok {
		return
	}
	targetSessionID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.AppErrorResponse(c, common.NewValidationError("session id must be a valid UUID"))
		return
	}
	if err := h.service.RevokeSession(c.Request.Context(), userID, currentSessionID, targetSessionID, requestClient(c)); err != nil {
		respondError(c, err, "failed to revoke session")
		return
	}
	common.SuccessResponse(c, MessageResponse{Message: "session revoked"})
}

func (h *Handler) RevokeAllSessions(c *gin.Context) {
	userID, sessionID, ok := requireAuthIDs(c)
	if !ok {
		return
	}
	var req CurrentPasswordRequest
	if !bindJSON(c, &req) {
		return
	}
	if err := h.service.RevokeAllSessions(c.Request.Context(), userID, sessionID, req.CurrentPassword, requestClient(c)); err != nil {
		respondError(c, err, "failed to revoke sessions")
		return
	}
	common.SuccessResponse(c, MessageResponse{Message: "all sessions revoked"})
}

func (h *Handler) GetProfile(c *gin.Context) {
	userID, _, ok := requireAuthIDs(c)
	if !ok {
		return
	}
	user, err := h.service.GetProfile(c.Request.Context(), userID)
	if err != nil {
		respondError(c, err, "failed to get profile")
		return
	}
	common.SuccessResponse(c, user)
}

func (h *Handler) UpdateProfile(c *gin.Context) {
	userID, _, ok := requireAuthIDs(c)
	if !ok {
		return
	}
	var req UpdateProfileRequest
	if !bindJSON(c, &req) {
		return
	}
	user, err := h.service.UpdateProfile(c.Request.Context(), userID, &req)
	if err != nil {
		respondError(c, err, "failed to update profile")
		return
	}
	common.SuccessResponse(c, user)
}

func (h *Handler) ChangePassword(c *gin.Context) {
	userID, sessionID, ok := requireAuthIDs(c)
	if !ok {
		return
	}
	var req ChangePasswordRequest
	if !bindJSON(c, &req) {
		return
	}
	if err := h.service.ChangePassword(c.Request.Context(), userID, sessionID, &req, requestClient(c)); err != nil {
		respondError(c, err, "failed to change password")
		return
	}
	common.SuccessResponse(c, MessageResponse{Message: "password changed"})
}

func (h *Handler) RegenerateRecoveryCodes(c *gin.Context) {
	userID, sessionID, ok := requireAuthIDs(c)
	if !ok {
		return
	}
	var req CurrentPasswordRequest
	if !bindJSON(c, &req) {
		return
	}
	codes, err := h.service.RegenerateRecoveryCodes(c.Request.Context(), userID, sessionID, req.CurrentPassword, requestClient(c))
	if err != nil {
		respondError(c, err, "failed to generate recovery codes")
		return
	}
	common.SuccessResponse(c, RecoveryCodesResponse{RecoveryCodes: codes})
}

func (h *Handler) ResetPasswordWithRecoveryCode(c *gin.Context) {
	var req RecoveryCodeResetRequest
	if !bindJSON(c, &req) {
		return
	}
	if err := h.service.ResetPasswordWithRecoveryCode(c.Request.Context(), &req, requestClient(c)); err != nil {
		respondError(c, err, "password reset failed")
		return
	}
	common.SuccessResponse(c, MessageResponse{Message: "password reset; all sessions revoked"})
}

func (h *Handler) DeactivateAccount(c *gin.Context) {
	userID, sessionID, ok := requireAuthIDs(c)
	if !ok {
		return
	}
	var req CurrentPasswordRequest
	if !bindJSON(c, &req) {
		return
	}
	if err := h.service.DeactivateAccount(c.Request.Context(), userID, sessionID, req.CurrentPassword, requestClient(c)); err != nil {
		respondError(c, err, "failed to deactivate account")
		return
	}
	common.SuccessResponse(c, MessageResponse{Message: "account deactivated"})
}

func (h *Handler) ReactivateAccount(c *gin.Context) {
	var req ReactivateAccountRequest
	if !bindJSON(c, &req) {
		return
	}
	response, err := h.service.ReactivateAccount(c.Request.Context(), &req, requestClient(c))
	if err != nil {
		respondError(c, err, "account reactivation failed")
		return
	}
	common.SuccessResponse(c, response)
}

func (h *Handler) DeleteAccount(c *gin.Context) {
	userID, sessionID, ok := requireAuthIDs(c)
	if !ok {
		return
	}
	var req CurrentPasswordRequest
	if !bindJSON(c, &req) {
		return
	}
	if err := h.service.DeleteAccount(c.Request.Context(), userID, sessionID, req.CurrentPassword, requestClient(c)); err != nil {
		respondError(c, err, "failed to delete account")
		return
	}
	common.SuccessResponse(c, MessageResponse{Message: "account deleted"})
}

func bindJSON(c *gin.Context, target interface{}) bool {
	if err := c.ShouldBindJSON(target); err != nil {
		common.AppErrorResponse(c, common.NewValidationError("invalid request body"))
		return false
	}
	return true
}

func authIDs(c *gin.Context) (uuid.UUID, uuid.UUID, error) {
	userID, err := middleware.GetUserID(c)
	if err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	sessionID, err := middleware.GetSessionID(c)
	if err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	return userID, sessionID, nil
}

func requireAuthIDs(c *gin.Context) (uuid.UUID, uuid.UUID, bool) {
	userID, sessionID, err := authIDs(c)
	if err != nil {
		respondError(c, invalidSessionError(), "authorization failed")
		return uuid.Nil, uuid.Nil, false
	}
	return userID, sessionID, true
}

func requestClient(c *gin.Context) ClientInfo {
	return ClientInfo{IPAddress: c.ClientIP(), UserAgent: c.Request.UserAgent()}
}

func respondError(c *gin.Context, err error, fallback string) {
	var appErr *common.AppError
	if errors.As(err, &appErr) {
		common.AppErrorResponse(c, appErr)
		return
	}
	common.ErrorResponse(c, http.StatusInternalServerError, fallback)
}
