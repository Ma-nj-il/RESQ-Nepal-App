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

		protected := auth.Group("")
		protected.Use(middleware.AuthMiddlewareWithProvider(jwtProvider))
		{
			protected.GET("/profile", h.handler.GetProfile)
			protected.PUT("/profile", h.handler.UpdateProfile)
		}
	}
}
