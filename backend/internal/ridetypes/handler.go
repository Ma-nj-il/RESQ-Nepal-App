package ridetypes

import (
	"net/http"
	"strconv"

	"github.com/bikky-kc013/medi-ambulance/pkg/common"
	"github.com/gin-gonic/gin"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) RegisterRoutes(rg *gin.RouterGroup) {
	rt := rg.Group("/ride-types")
	{
		rt.GET("/available", h.GetAvailableRideTypes)
	}
}

func (h *Handler) GetAvailableRideTypes(c *gin.Context) {
	latStr := c.Query("latitude")
	lngStr := c.Query("longitude")

	if latStr == "" || lngStr == "" {
		common.ErrorResponse(c, http.StatusBadRequest, "latitude and longitude are required")
		return
	}

	latitude, err := strconv.ParseFloat(latStr, 64)
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid latitude value")
		return
	}

	longitude, err := strconv.ParseFloat(lngStr, 64)
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid longitude value")
		return
	}

	rideTypes, err := h.service.GetAvailableRideTypes(c.Request.Context(), latitude, longitude)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to get available ride types")
		return
	}

	common.SuccessResponse(c, rideTypes)
}
