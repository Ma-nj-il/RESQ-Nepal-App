package pricing

import (
	"net/http"
	"strconv"

	"github.com/bikky-kc013/medi-ambulance/pkg/common"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type RideTypesProvider interface {
	GetAvailableRideTypes(ctx interface{}, latitude, longitude float64) ([]interface{}, error)
}

type Handler struct {
	service           *Service
	rideTypesProvider RideTypesProvider
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func NewHandlerWithRideTypes(service *Service, rideTypesProvider RideTypesProvider) *Handler {
	return &Handler{
		service:           service,
		rideTypesProvider: rideTypesProvider,
	}
}

func (h *Handler) GetEstimate(c *gin.Context) {
	var req EstimateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	estimate, err := h.service.GetEstimate(c.Request.Context(), req)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to calculate estimate")
		return
	}

	common.SuccessResponse(c, estimate)
}

func (h *Handler) GetBulkEstimate(c *gin.Context) {
	var req BulkEstimateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	var rideTypes []RideTypeInfo
	if h.rideTypesProvider != nil {
		rawRideTypes, err := h.rideTypesProvider.GetAvailableRideTypes(c.Request.Context(), req.PickupLatitude, req.PickupLongitude)
		if err != nil {
			common.ErrorResponse(c, http.StatusInternalServerError, "failed to get available ride types")
			return
		}

		for _, rt := range rawRideTypes {
			if rtMap, ok := rt.(map[string]interface{}); ok {
				rideTypeInfo := RideTypeInfo{
					Name:        getString(rtMap, "name"),
					Description: getString(rtMap, "description"),
					Capacity:    getInt(rtMap, "capacity"),
				}
				if idStr, ok := rtMap["id"].(string); ok {
					if id, err := uuid.Parse(idStr); err == nil {
						rideTypeInfo.ID = id
					}
				}
				if iconURL, ok := rtMap["icon_url"].(string); ok && iconURL != "" {
					rideTypeInfo.IconURL = &iconURL
				}
				rideTypes = append(rideTypes, rideTypeInfo)
			}
		}
	}

	if len(rideTypes) == 0 {
		common.ErrorResponse(c, http.StatusNotFound, "no ride types available for this location")
		return
	}

	bulkEstimate, err := h.service.GetBulkEstimate(c.Request.Context(), req, rideTypes)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to calculate estimates")
		return
	}

	common.SuccessResponse(c, bulkEstimate)
}

func getString(m map[string]interface{}, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

func getInt(m map[string]interface{}, key string) int {
	if v, ok := m[key].(float64); ok {
		return int(v)
	}
	if v, ok := m[key].(int); ok {
		return v
	}
	return 0
}

func (h *Handler) GetSurge(c *gin.Context) {
	latStr := c.Query("latitude")
	lngStr := c.Query("longitude")

	if latStr == "" || lngStr == "" {
		common.ErrorResponse(c, http.StatusBadRequest, "latitude and longitude are required")
		return
	}

	latitude, err := strconv.ParseFloat(latStr, 64)
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid latitude")
		return
	}

	longitude, err := strconv.ParseFloat(lngStr, 64)
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid longitude")
		return
	}

	surgeInfo, err := h.service.GetSurgeInfo(c.Request.Context(), latitude, longitude)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get surge info")
		return
	}

	common.SuccessResponse(c, surgeInfo)
}

func (h *Handler) ValidatePrice(c *gin.Context) {
	var req struct {
		EstimateRequest
		NegotiatedPrice float64 `json:"negotiated_price" binding:"required,gt=0"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	err := h.service.ValidateNegotiatedPrice(c.Request.Context(), req.EstimateRequest, req.NegotiatedPrice)
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	estimate, _ := h.service.GetEstimate(c.Request.Context(), req.EstimateRequest)

	common.SuccessResponse(c, gin.H{
		"valid":            true,
		"negotiated_price": req.NegotiatedPrice,
		"estimated_price":  estimate.EstimatedFare,
		"variance_pct":     ((req.NegotiatedPrice - estimate.EstimatedFare) / estimate.EstimatedFare) * 100,
	})
}

func (h *Handler) GetPricing(c *gin.Context) {
	latStr := c.Query("latitude")
	lngStr := c.Query("longitude")
	rideTypeIDStr := c.Query("ride_type_id")

	if latStr == "" || lngStr == "" {
		common.ErrorResponse(c, http.StatusBadRequest, "latitude and longitude are required")
		return
	}

	latitude, err := strconv.ParseFloat(latStr, 64)
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid latitude")
		return
	}

	longitude, err := strconv.ParseFloat(lngStr, 64)
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid longitude")
		return
	}

	var rideTypeID *uuid.UUID
	if rideTypeIDStr != "" {
		id, err := uuid.Parse(rideTypeIDStr)
		if err != nil {
			common.ErrorResponse(c, http.StatusBadRequest, "invalid ride_type_id")
			return
		}
		rideTypeID = &id
	}

	pricing, err := h.service.GetPricing(c.Request.Context(), latitude, longitude, rideTypeID)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get pricing")
		return
	}

	common.SuccessResponse(c, pricing)
}

func (h *Handler) GetCancellationFee(c *gin.Context) {
	var req struct {
		Latitude            float64 `json:"latitude" binding:"required"`
		Longitude           float64 `json:"longitude" binding:"required"`
		MinutesSinceRequest float64 `json:"minutes_since_request" binding:"required,gte=0"`
		EstimatedFare       float64 `json:"estimated_fare" binding:"required,gt=0"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	fee, err := h.service.GetCancellationFee(
		c.Request.Context(),
		req.Latitude, req.Longitude,
		req.MinutesSinceRequest,
		req.EstimatedFare,
	)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to calculate cancellation fee")
		return
	}

	common.SuccessResponse(c, gin.H{
		"cancellation_fee":      fee,
		"minutes_since_request": req.MinutesSinceRequest,
	})
}

func (h *Handler) RegisterRoutes(rg *gin.RouterGroup) {
	pricing := rg.Group("/pricing")
	{
		pricing.POST("/estimate", h.GetEstimate)
		pricing.POST("/bulk-estimate", h.GetBulkEstimate)
		pricing.GET("/surge", h.GetSurge)
		pricing.POST("/validate", h.ValidatePrice)
		pricing.GET("/config", h.GetPricing)
		pricing.POST("/cancellation-fee", h.GetCancellationFee)
	}
}
