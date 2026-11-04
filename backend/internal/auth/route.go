package auth

import (
	"github.com/bikky-kc013/medi-ambulance/pkg/jwtkeys"
	"github.com/bikky-kc013/medi-ambulance/pkg/middleware"
	"github.com/gin-gonic/gin"
)

type Route struct {
	handler *Handler
}

func NewRouter(handler *Handler) *Route {
	return &Route{handler: handler}
}

func (h *Route) RegisterRoutes(r *gin.Engine, jwtProvider jwtkeys.KeyProvider) {
	auth := r.Group("/api/v1/auth")
	{
		auth.POST("/register", h.handler.Register)
		auth.POST("/login", h.handler.Login)
		auth.POST("/token/refresh", h.handler.Refresh)
		auth.POST("/password/reset/recovery-code", h.handler.ResetPasswordWithRecoveryCode)
		auth.POST("/account/reactivate", h.handler.ReactivateAccount)

		protected := auth.Group("")
		protected.Use(middleware.AuthMiddlewareWithProvider(jwtProvider), h.handler.RequireActiveSession())
		{
			protected.POST("/logout", h.handler.Logout)
			protected.GET("/sessions", h.handler.ListSessions)
			protected.DELETE("/sessions/:id", h.handler.RevokeSession)
			protected.POST("/sessions/revoke-all", h.handler.RevokeAllSessions)
			protected.GET("/profile", h.handler.GetProfile)
			protected.PATCH("/profile", h.handler.UpdateProfile)
			protected.PUT("/profile", h.handler.UpdateProfile)
			protected.POST("/password/change", h.handler.ChangePassword)
			protected.POST("/recovery-codes/regenerate", h.handler.RegenerateRecoveryCodes)
			protected.POST("/account/deactivate", h.handler.DeactivateAccount)
			protected.DELETE("/account", h.handler.DeleteAccount)
		}
	}
}
