package maps

import (
	"net/http"
	"strconv"

	"github.com/bikky-kc013/medi-ambulance/pkg/common"
	"github.com/bikky-kc013/medi-ambulance/pkg/config"
	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	"github.com/bikky-kc013/medi-ambulance/pkg/middleware"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

type Handler struct {
	service       *Service
	timeOutConfig config.TimeoutConfig
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) RegisterRoutes(rg *gin.RouterGroup) {
	maps := rg.Group("/maps")
	{
		maps.POST("/route", h.GetRoute)
		maps.POST("/eta", h.GetETA)
		maps.POST("/distance-matrix", h.GetDistanceMatrix)

		maps.POST("/traffic/flow", h.GetTrafficFlow)
		maps.POST("/traffic/incidents", h.GetTrafficIncidents)

		maps.POST("/geocode", h.Geocode)
		maps.POST("/reverse-geocode", h.ReverseGeocode)

		maps.POST("/places/search", h.SearchPlaces)

		maps.POST("/roads/snap", h.SnapToRoad)
		maps.POST("/roads/speed-limits", h.GetSpeedLimits)

		maps.GET("/health", h.HealthCheck)
		maps.POST("/waypoints/optimize", h.OptimizeWaypoints)
		maps.POST("/eta/batch", h.BatchGetETA)
	}
}

func (h *Handler) GetRoute(c *gin.Context) {
	var req RouteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid request: "+err.Error())
		return
	}

	if !isValidCoordinate(req.Origin) || !isValidCoordinate(req.Destination) {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid coordinates")
		return
	}

	ctx := c.Request.Context()
	resp, err := h.service.GetRoute(ctx, &req)
	if err != nil {
		logger.Error("Failed to get route", zap.Error(err))
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to calculate route")
		return
	}

	common.SuccessResponse(c, resp)
}

func (h *Handler) GetETA(c *gin.Context) {
	var req ETARequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid request: "+err.Error())
		return
	}

	if !isValidCoordinate(req.Origin) || !isValidCoordinate(req.Destination) {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid coordinates")
		return
	}

	ctx := c.Request.Context()
	resp, err := h.service.GetTrafficAwareETA(ctx, req.Origin, req.Destination)
	if err != nil {
		logger.Error("Failed to get ETA", zap.Error(err))
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to calculate ETA")
		return
	}

	common.SuccessResponse(c, resp)
}

func (h *Handler) BatchGetETA(c *gin.Context) {
	var requests []*ETARequest
	if err := c.ShouldBindJSON(&requests); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid request: "+err.Error())
		return
	}

	if len(requests) > 100 {
		common.ErrorResponse(c, http.StatusBadRequest, "maximum 100 requests per batch")
		return
	}

	for i, req := range requests {
		if !isValidCoordinate(req.Origin) || !isValidCoordinate(req.Destination) {
			common.ErrorResponse(c, http.StatusBadRequest, "invalid coordinates at index "+strconv.Itoa(i))
			return
		}
	}

	ctx := c.Request.Context()
	responses, err := h.service.BatchGetETA(ctx, requests)
	if err != nil {
		logger.Error("Failed to batch get ETA", zap.Error(err))
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to calculate ETAs")
		return
	}

	common.SuccessResponse(c, responses)
}

func (h *Handler) GetDistanceMatrix(c *gin.Context) {
	var req DistanceMatrixRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid request: "+err.Error())
		return
	}

	if len(req.Origins) == 0 || len(req.Destinations) == 0 {
		common.ErrorResponse(c, http.StatusBadRequest, "origins and destinations are required")
		return
	}

	if len(req.Origins)*len(req.Destinations) > 625 { // 25x25 max
		common.ErrorResponse(c, http.StatusBadRequest, "maximum 625 elements (25 origins x 25 destinations)")
		return
	}

	ctx := c.Request.Context()
	resp, err := h.service.GetDistanceMatrix(ctx, &req)
	if err != nil {
		logger.Error("Failed to get distance matrix", zap.Error(err))
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to calculate distance matrix")
		return
	}

	common.SuccessResponse(c, resp)
}

func (h *Handler) GetTrafficFlow(c *gin.Context) {
	var req TrafficFlowRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid request: "+err.Error())
		return
	}

	ctx := c.Request.Context()
	resp, err := h.service.GetTrafficFlow(ctx, &req)
	if err != nil {
		logger.Error("Failed to get traffic flow", zap.Error(err))
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get traffic data")
		return
	}

	common.SuccessResponse(c, resp)
}

func (h *Handler) GetTrafficIncidents(c *gin.Context) {
	var req TrafficIncidentsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid request: "+err.Error())
		return
	}

	ctx := c.Request.Context()
	resp, err := h.service.GetTrafficIncidents(ctx, &req)
	if err != nil {
		logger.Error("Failed to get traffic incidents", zap.Error(err))
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get traffic incidents")
		return
	}

	common.SuccessResponse(c, resp)
}

func (h *Handler) Geocode(c *gin.Context) {
	var req GeocodingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid request: "+err.Error())
		return
	}

	if req.Address == "" {
		common.ErrorResponse(c, http.StatusBadRequest, "address is required")
		return
	}

	ctx := c.Request.Context()
	resp, err := h.service.Geocode(ctx, &req)
	if err != nil {
		logger.Error("Failed to geocode", zap.Error(err))
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to geocode address")
		return
	}

	common.SuccessResponse(c, resp)
}

func (h *Handler) ReverseGeocode(c *gin.Context) {
	var req GeocodingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid request: "+err.Error())
		return
	}

	if req.Coordinate == nil {
		common.ErrorResponse(c, http.StatusBadRequest, "coordinate is required")
		return
	}

	if !isValidCoordinate(*req.Coordinate) {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid coordinate")
		return
	}

	ctx := c.Request.Context()
	resp, err := h.service.ReverseGeocode(ctx, &req)
	if err != nil {
		logger.Error("Failed to reverse geocode", zap.Error(err))
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to reverse geocode")
		return
	}

	common.SuccessResponse(c, resp)
}

func (h *Handler) SearchPlaces(c *gin.Context) {
	var req PlaceSearchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid request: "+err.Error())
		return
	}

	if req.Query == "" && req.Location == nil {
		common.ErrorResponse(c, http.StatusBadRequest, "query or location is required")
		return
	}

	ctx := c.Request.Context()
	resp, err := h.service.SearchPlaces(ctx, &req)
	if err != nil {
		logger.Error("Failed to search places", zap.Error(err))
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to search places")
		return
	}

	common.SuccessResponse(c, resp)
}

func (h *Handler) SnapToRoad(c *gin.Context) {
	var req SnapToRoadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid request: "+err.Error())
		return
	}

	if len(req.Path) == 0 {
		common.ErrorResponse(c, http.StatusBadRequest, "path is required")
		return
	}

	if len(req.Path) > 100 {
		common.ErrorResponse(c, http.StatusBadRequest, "maximum 100 points per request")
		return
	}

	ctx := c.Request.Context()
	resp, err := h.service.SnapToRoad(ctx, &req, h.timeOutConfig)
	if err != nil {
		logger.Error("Failed to snap to road", zap.Error(err))
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to snap to road")
		return
	}

	common.SuccessResponse(c, resp)
}

func (h *Handler) GetSpeedLimits(c *gin.Context) {
	var req SpeedLimitsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid request: "+err.Error())
		return
	}

	if len(req.Path) == 0 && len(req.PlaceIDs) == 0 {
		common.ErrorResponse(c, http.StatusBadRequest, "path or place_ids is required")
		return
	}

	ctx := c.Request.Context()
	resp, err := h.service.GetSpeedLimits(ctx, &req, h.timeOutConfig)
	if err != nil {
		logger.Error("Failed to get speed limits", zap.Error(err))
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get speed limits")
		return
	}

	common.SuccessResponse(c, resp)
}

func (h *Handler) OptimizeWaypoints(c *gin.Context) {
	var req OptimizeWaypointsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid request: "+err.Error())
		return
	}

	if len(req.Waypoints) == 0 {
		common.ErrorResponse(c, http.StatusBadRequest, "waypoints are required")
		return
	}

	if len(req.Waypoints) > 23 {
		common.ErrorResponse(c, http.StatusBadRequest, "maximum 23 waypoints")
		return
	}

	ctx := c.Request.Context()
	order, err := h.service.OptimizeWaypoints(ctx, req.Origin, req.Waypoints, req.Destination)
	if err != nil {
		logger.Error("Failed to optimize waypoints", zap.Error(err))
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to optimize waypoints")
		return
	}

	optimizedWaypoints := make([]Coordinate, len(order))
	for i, idx := range order {
		optimizedWaypoints[i] = req.Waypoints[idx]
	}

	common.SuccessResponse(c, OptimizeWaypointsResponse{
		Order:              order,
		OptimizedWaypoints: optimizedWaypoints,
	})
}

func (h *Handler) HealthCheck(c *gin.Context) {
	ctx := c.Request.Context()
	results := h.service.HealthCheck(ctx)

	status := "healthy"
	errors := make(map[string]string)

	for provider, err := range results {
		if err != nil {
			status = "degraded"
			errors[string(provider)] = err.Error()
		}
	}

	if err, ok := results[h.service.GetPrimaryProvider()]; ok && err != nil {
		status = "unhealthy"
	}

	common.SuccessResponse(c, gin.H{
		"status":    status,
		"primary":   h.service.GetPrimaryProvider(),
		"errors":    errors,
		"providers": results,
	})
}

type OptimizeWaypointsRequest struct {
	Origin      Coordinate   `json:"origin" binding:"required"`
	Waypoints   []Coordinate `json:"waypoints" binding:"required"`
	Destination Coordinate   `json:"destination" binding:"required"`
}

type OptimizeWaypointsResponse struct {
	Order              []int        `json:"order"`
	OptimizedWaypoints []Coordinate `json:"optimized_waypoints"`
}

func isValidCoordinate(c Coordinate) bool {
	return c.Latitude >= -90 && c.Latitude <= 90 &&
		c.Longitude >= -180 && c.Longitude <= 180
}

func (h *Handler) RegisterInternalRoutes(rg *gin.RouterGroup) {
	internal := rg.Group("/internal/maps")
	{
		internal.GET("/eta", func(c *gin.Context) {
			originLatitude, _ := strconv.ParseFloat(c.Query("origin_latitude"), 64)
			originLongitude, _ := strconv.ParseFloat(c.Query("origin_longitude"), 64)
			destLatitude, _ := strconv.ParseFloat(c.Query("dest_latitude"), 64)
			destLongitude, _ := strconv.ParseFloat(c.Query("dest_longitude"), 64)

			if originLatitude == 0 || originLongitude == 0 || destLatitude == 0 || destLongitude == 0 {
				common.ErrorResponse(c, http.StatusBadRequest, "invalid coordinates")
				return
			}

			req := &ETARequest{
				Origin:      Coordinate{Latitude: originLatitude, Longitude: originLongitude},
				Destination: Coordinate{Latitude: destLatitude, Longitude: destLongitude},
			}

			ctx := c.Request.Context()
			resp, err := h.service.GetETA(ctx, req)
			if err != nil {
				common.ErrorResponse(c, http.StatusInternalServerError, "Failed to get ETA")
				return
			}

			common.SuccessResponse(c, resp)
		})

		internal.GET("/traffic", func(c *gin.Context) {
			latitude, _ := strconv.ParseFloat(c.Query("latitude"), 64)
			longitude, _ := strconv.ParseFloat(c.Query("longitude"), 64)

			if latitude == 0 || longitude == 0 {
				common.ErrorResponse(c, http.StatusBadRequest, "invalid coordinates")
				return
			}

			req := &TrafficFlowRequest{
				Location:     Coordinate{Latitude: latitude, Longitude: longitude},
				RadiusMeters: 5000,
			}

			ctx := c.Request.Context()
			resp, err := h.service.GetTrafficFlow(ctx, req)
			if err != nil {
				common.ErrorResponse(c, http.StatusInternalServerError, "Failed to get traffic flow")
				return
			}

			common.SuccessResponse(c, gin.H{
				"traffic_level": resp.OverallLevel,
				"updated_at":    resp.UpdatedAt,
			})
		})
	}
}

func (h *Handler) RegisterAdminRoutes(rg *gin.RouterGroup, authMiddleware gin.HandlerFunc) {
	admin := rg.Group("/admin/maps")
	admin.Use(authMiddleware)
	admin.Use(middleware.RequireRole("admin"))
	{
		admin.GET("/stats", func(c *gin.Context) {
			common.SuccessResponse(c, gin.H{
				"primary_provider": h.service.GetPrimaryProvider(),
				"fallback_count":   len(h.service.fallbacks),
				"cache_enabled":    h.service.config.CacheEnabled,
				"traffic_enabled":  h.service.config.TrafficEnabled,
			})
		})
	}
}
