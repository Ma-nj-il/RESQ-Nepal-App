package geography

import (
	"net/http"

	"github.com/bikky-kc013/medi-ambulance/pkg/common"
	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	"github.com/bikky-kc013/medi-ambulance/pkg/pagination"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

// AdminHandler handles admin HTTP requests for geography management
type AdminHandler struct {
	service *Service
}

// NewAdminHandler creates a new geography admin handler
func NewAdminHandler(service *Service) *AdminHandler {
	return &AdminHandler{service: service}
}

// getAdminID extracts the authenticated admin user ID from the request context
func getAdminID(c *gin.Context) uuid.UUID {
	if id, ok := c.Get("user_id"); ok {
		if uid, ok := id.(uuid.UUID); ok {
			return uid
		}
	}
	return uuid.Nil
}

// RegisterRoutes registers geography admin routes
func (h *AdminHandler) RegisterRoutes(rg *gin.RouterGroup) {
	geo := rg.Group("/geography")
	{
		// Stats
		geo.GET("/stats", h.GetStats)

		// Countries
		countries := geo.Group("/countries")
		{
			countries.GET("", h.ListCountries)
			countries.POST("", h.CreateCountry)
			countries.GET("/:id", h.GetCountry)
			countries.PUT("/:id", h.UpdateCountry)
			countries.DELETE("/:id", h.DeleteCountry)
			countries.GET("/:id/regions", h.ListRegionsByCountry)
			countries.POST("/:id/regions", h.CreateRegion)
		}

		// Regions
		regions := geo.Group("/regions")
		{
			regions.GET("/:id", h.GetRegion)
			regions.PUT("/:id", h.UpdateRegion)
			regions.DELETE("/:id", h.DeleteRegion)
			regions.GET("/:id/cities", h.ListCitiesByRegion)
			regions.POST("/:id/cities", h.CreateCity)
		}

		// Cities
		cities := geo.Group("/cities")
		{
			cities.GET("/:id", h.GetCity)
			cities.PUT("/:id", h.UpdateCity)
			cities.DELETE("/:id", h.DeleteCity)
			cities.GET("/:id/zones", h.ListZonesByCity)
			cities.POST("/:id/zones", h.CreateZone)
		}

		// Zones
		zones := geo.Group("/zones")
		{
			zones.GET("/:id", h.GetZone)
			zones.PUT("/:id", h.UpdateZone)
			zones.DELETE("/:id", h.DeleteZone)
		}
	}
}

// --- Countries ---

// ListCountries lists all countries with pagination
func (h *AdminHandler) ListCountries(c *gin.Context) {
	params := pagination.ParseParams(c)
	search := c.Query("search")

	countries, total, err := h.service.GetAllCountries(c.Request.Context(), params.Limit, params.Offset, search)
	if err != nil {
		logger.Error("Failed to fetch countries", zap.Error(err))
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to fetch countries")
		return
	}

	meta := pagination.BuildMeta(params.Limit, params.Offset, total)
	common.SuccessResponseWithMeta(c, countries, meta)
}

// CreateCountry creates a new country
func (h *AdminHandler) CreateCountry(c *gin.Context) {
	var req CreateCountryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	country := &Country{
		Code:                    req.Code,
		Code3:                   req.Code3,
		Name:                    req.Name,
		NativeName:              req.NativeName,
		CurrencyCode:            req.CurrencyCode,
		DefaultLanguage:         req.DefaultLanguage,
		Timezone:                req.Timezone,
		PhonePrefix:             req.PhonePrefix,
		IsActive:                req.IsActive,
		PaymentMethods:          req.PaymentMethods,
		RequiredDriverDocuments: req.RequiredDriverDocuments,
	}

	if err := h.service.CreateCountry(c.Request.Context(), country); err != nil {
		logger.Error("Failed to create country", zap.Error(err))
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to create country")
		return
	}

	common.SuccessResponseWithStatus(c, http.StatusCreated, country, "Country created successfully")
}

// GetCountry retrieves a country by ID
func (h *AdminHandler) GetCountry(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid country ID")
		return
	}

	country, err := h.service.GetCountryByID(c.Request.Context(), id)
	if err != nil {
		common.ErrorResponse(c, http.StatusNotFound, "Country not found")
		return
	}

	common.SuccessResponse(c, country)
}

// UpdateCountry updates a country
func (h *AdminHandler) UpdateCountry(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid country ID")
		return
	}

	// Get existing country
	country, err := h.service.GetCountryByID(c.Request.Context(), id)
	if err != nil {
		common.ErrorResponse(c, http.StatusNotFound, "Country not found")
		return
	}

	var req UpdateCountryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	// Apply partial updates
	if req.Code != nil {
		country.Code = *req.Code
	}
	if req.Code3 != nil {
		country.Code3 = *req.Code3
	}
	if req.Name != nil {
		country.Name = *req.Name
	}
	if req.NativeName != nil {
		country.NativeName = req.NativeName
	}
	if req.CurrencyCode != nil {
		country.CurrencyCode = *req.CurrencyCode
	}
	if req.DefaultLanguage != nil {
		country.DefaultLanguage = *req.DefaultLanguage
	}
	if req.Timezone != nil {
		country.Timezone = *req.Timezone
	}
	if req.PhonePrefix != nil {
		country.PhonePrefix = *req.PhonePrefix
	}
	if req.IsActive != nil {
		country.IsActive = *req.IsActive
	}
	if req.PaymentMethods != nil {
		country.PaymentMethods = req.PaymentMethods
	}
	if req.RequiredDriverDocuments != nil {
		country.RequiredDriverDocuments = req.RequiredDriverDocuments
	}

	if err := h.service.UpdateCountry(c.Request.Context(), country); err != nil {
		logger.Error("Failed to update country", zap.Error(err))
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to update country")
		return
	}

	common.SuccessResponse(c, country)
}

func (h *AdminHandler) DeleteCountry(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid country ID")
		return
	}

	if err := h.service.DeleteCountry(c.Request.Context(), id); err != nil {
		logger.Error("Failed to delete country", zap.Error(err))
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to delete country")
		return
	}

	common.SuccessResponseWithStatus(c, http.StatusOK, nil, "Country deleted successfully")
}

// --- Regions ---

// ListRegionsByCountry lists all regions for a country
func (h *AdminHandler) ListRegionsByCountry(c *gin.Context) {
	countryID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid country ID")
		return
	}

	params := pagination.ParseParams(c)
	search := c.Query("search")

	regions, total, err := h.service.GetAllRegions(c.Request.Context(), &countryID, params.Limit, params.Offset, search)
	if err != nil {
		logger.Error("Failed to fetch regions", zap.Error(err))
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to fetch regions")
		return
	}

	meta := pagination.BuildMeta(params.Limit, params.Offset, total)
	common.SuccessResponseWithMeta(c, regions, meta)
}

// CreateRegion creates a new region under a country
func (h *AdminHandler) CreateRegion(c *gin.Context) {
	countryID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid country ID")
		return
	}

	var req CreateRegionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	region := &Region{
		CountryID:  countryID,
		Code:       req.Code,
		Name:       req.Name,
		NativeName: req.NativeName,
		Timezone:   req.Timezone,
		IsActive:   req.IsActive,
	}

	if err := h.service.CreateRegion(c.Request.Context(), region); err != nil {
		logger.Error("Failed to create region", zap.Error(err))
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to create region")
		return
	}

	common.SuccessResponseWithStatus(c, http.StatusCreated, region, "Region created successfully")
}

// GetRegion retrieves a region by ID
func (h *AdminHandler) GetRegion(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid region ID")
		return
	}

	region, err := h.service.GetRegionByID(c.Request.Context(), id)
	if err != nil {
		common.ErrorResponse(c, http.StatusNotFound, "Region not found")
		return
	}

	common.SuccessResponse(c, region)
}

// UpdateRegion updates a region
func (h *AdminHandler) UpdateRegion(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid region ID")
		return
	}

	region, err := h.service.GetRegionByID(c.Request.Context(), id)
	if err != nil {
		common.ErrorResponse(c, http.StatusNotFound, "Region not found")
		return
	}

	var req UpdateRegionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	if req.Code != nil {
		region.Code = *req.Code
	}
	if req.Name != nil {
		region.Name = *req.Name
	}
	if req.NativeName != nil {
		region.NativeName = req.NativeName
	}
	if req.Timezone != nil {
		region.Timezone = req.Timezone
	}
	if req.IsActive != nil {
		region.IsActive = *req.IsActive
	}

	if err := h.service.UpdateRegion(c.Request.Context(), region); err != nil {
		logger.Error("Failed to update region", zap.Error(err))
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to update region")
		return
	}

	common.SuccessResponse(c, region)
}

// DeleteRegion soft-deletes a region
func (h *AdminHandler) DeleteRegion(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid region ID")
		return
	}

	if err := h.service.DeleteRegion(c.Request.Context(), id); err != nil {
		logger.Error("Failed to delete region", zap.Error(err))
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to delete region")
		return
	}

	common.SuccessResponseWithStatus(c, http.StatusOK, nil, "Region deleted successfully")
}

// --- Cities ---

// ListCitiesByRegion lists all cities for a region
func (h *AdminHandler) ListCitiesByRegion(c *gin.Context) {
	regionID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid region ID")
		return
	}

	params := pagination.ParseParams(c)
	search := c.Query("search")

	cities, total, err := h.service.GetAllCities(c.Request.Context(), &regionID, params.Limit, params.Offset, search)
	if err != nil {
		logger.Error("Failed to fetch cities", zap.Error(err))
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to fetch cities")
		return
	}

	meta := pagination.BuildMeta(params.Limit, params.Offset, total)
	common.SuccessResponseWithMeta(c, cities, meta)
}

// CreateCity creates a new city under a region
func (h *AdminHandler) CreateCity(c *gin.Context) {
	regionID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid region ID")
		return
	}

	var req CreateCityRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	city := &City{
		RegionID:        regionID,
		Name:            req.Name,
		NativeName:      req.NativeName,
		Timezone:        req.Timezone,
		CenterLatitude:  req.CenterLatitude,
		CenterLongitude: req.CenterLongitude,
		Boundary:        req.Boundary,
		Population:      req.Population,
		IsActive:        req.IsActive,
	}

	if err := h.service.CreateCity(c.Request.Context(), city); err != nil {
		logger.Error("Failed to create city", zap.Error(err))
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to create city")
		return
	}

	common.SuccessResponseWithStatus(c, http.StatusCreated, city, "City created successfully")
}

// GetCity retrieves a city by ID
func (h *AdminHandler) GetCity(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid city ID")
		return
	}

	city, err := h.service.GetCityByID(c.Request.Context(), id)
	if err != nil {
		common.ErrorResponse(c, http.StatusNotFound, "City not found")
		return
	}

	common.SuccessResponse(c, city)
}

// UpdateCity updates a city
func (h *AdminHandler) UpdateCity(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid city ID")
		return
	}

	city, err := h.service.GetCityByID(c.Request.Context(), id)
	if err != nil {
		common.ErrorResponse(c, http.StatusNotFound, "City not found")
		return
	}

	var req UpdateCityRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	if req.Name != nil {
		city.Name = *req.Name
	}
	if req.NativeName != nil {
		city.NativeName = req.NativeName
	}
	if req.Timezone != nil {
		city.Timezone = req.Timezone
	}
	if req.CenterLatitude != nil {
		city.CenterLatitude = *req.CenterLatitude
	}
	if req.CenterLongitude != nil {
		city.CenterLongitude = *req.CenterLongitude
	}
	if req.Boundary != nil {
		city.Boundary = req.Boundary
	}
	if req.Population != nil {
		city.Population = req.Population
	}
	if req.IsActive != nil {
		city.IsActive = *req.IsActive
	}

	if err := h.service.UpdateCity(c.Request.Context(), city); err != nil {
		logger.Error("Failed to update city", zap.Error(err))
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to update city")
		return
	}

	common.SuccessResponse(c, city)
}

// DeleteCity soft-deletes a city
func (h *AdminHandler) DeleteCity(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid city ID")
		return
	}

	if err := h.service.DeleteCity(c.Request.Context(), id); err != nil {
		logger.Error("Failed to delete city", zap.Error(err))
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to delete city")
		return
	}

	common.SuccessResponseWithStatus(c, http.StatusOK, nil, "City deleted successfully")
}

// --- Zones ---

// ListZonesByCity lists all pricing zones for a city
func (h *AdminHandler) ListZonesByCity(c *gin.Context) {
	cityID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid city ID")
		return
	}

	params := pagination.ParseParams(c)
	search := c.Query("search")

	zones, total, err := h.service.GetAllPricingZones(c.Request.Context(), &cityID, params.Limit, params.Offset, search)
	if err != nil {
		logger.Error("Failed to fetch zones", zap.Error(err))
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to fetch zones")
		return
	}

	meta := pagination.BuildMeta(params.Limit, params.Offset, total)
	common.SuccessResponseWithMeta(c, zones, meta)
}

// CreateZone creates a new pricing zone under a city
func (h *AdminHandler) CreateZone(c *gin.Context) {
	cityID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid city ID")
		return
	}

	var req CreateZoneRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	zone := &PricingZone{
		CityID:          cityID,
		Name:            req.Name,
		ZoneType:        req.ZoneType,
		Boundary:        req.Boundary,
		CenterLatitude:  req.CenterLatitude,
		CenterLongitude: req.CenterLongitude,
		Priority:        req.Priority,
		IsActive:        req.IsActive,
		Metadata:        req.Metadata,
	}

	if err := h.service.CreatePricingZone(c.Request.Context(), zone); err != nil {
		logger.Error("Failed to create zone", zap.Error(err))
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to create zone")
		return
	}

	common.SuccessResponseWithStatus(c, http.StatusCreated, zone, "Zone created successfully")
}

// GetZone retrieves a pricing zone by ID
func (h *AdminHandler) GetZone(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid zone ID")
		return
	}

	zone, err := h.service.GetPricingZoneByID(c.Request.Context(), id)
	if err != nil {
		common.ErrorResponse(c, http.StatusNotFound, "Zone not found")
		return
	}

	common.SuccessResponse(c, zone)
}

// UpdateZone updates a pricing zone
func (h *AdminHandler) UpdateZone(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid zone ID")
		return
	}

	zone, err := h.service.GetPricingZoneByID(c.Request.Context(), id)
	if err != nil {
		common.ErrorResponse(c, http.StatusNotFound, "Zone not found")
		return
	}

	var req UpdateZoneRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	if req.Name != nil {
		zone.Name = *req.Name
	}
	if req.ZoneType != nil {
		zone.ZoneType = *req.ZoneType
	}
	if req.Boundary != nil {
		zone.Boundary = *req.Boundary
	}
	if req.CenterLatitude != nil {
		zone.CenterLatitude = *req.CenterLatitude
	}
	if req.CenterLongitude != nil {
		zone.CenterLongitude = *req.CenterLongitude
	}
	if req.Priority != nil {
		zone.Priority = *req.Priority
	}
	if req.IsActive != nil {
		zone.IsActive = *req.IsActive
	}
	if req.Metadata != nil {
		zone.Metadata = req.Metadata
	}

	if err := h.service.UpdatePricingZone(c.Request.Context(), zone); err != nil {
		logger.Error("Failed to update zone", zap.Error(err))
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to update zone")
		return
	}

	common.SuccessResponse(c, zone)
}

// DeleteZone soft-deletes a pricing zone
func (h *AdminHandler) DeleteZone(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid zone ID")
		return
	}

	if err := h.service.DeletePricingZone(c.Request.Context(), id); err != nil {
		logger.Error("Failed to delete zone", zap.Error(err))
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to delete zone")
		return
	}

	common.SuccessResponseWithStatus(c, http.StatusOK, nil, "Zone deleted successfully")
}

// --- Stats ---

// GetStats returns aggregate counts for all geography entities
func (h *AdminHandler) GetStats(c *gin.Context) {
	stats, err := h.service.GetGeographyStats(c.Request.Context())
	if err != nil {
		logger.Error("Failed to fetch geography stats", zap.Error(err))
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to fetch geography stats")
		return
	}

	common.SuccessResponse(c, stats)
}
