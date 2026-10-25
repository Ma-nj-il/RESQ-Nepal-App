package pricing

import (
	"net/http"

	"github.com/bikky-kc013/medi-ambulance/pkg/common"
	"github.com/bikky-kc013/medi-ambulance/pkg/pagination"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type AdminHandler struct {
	repo    RepositoryInterface
	service *Service
}

func NewAdminHandler(repo RepositoryInterface, service *Service) *AdminHandler {
	return &AdminHandler{repo: repo, service: service}
}

func getAdminID(c *gin.Context) uuid.UUID {
	if id, ok := c.Get("user_id"); ok {
		if uid, ok := id.(uuid.UUID); ok {
			return uid
		}
	}
	return uuid.Nil
}

func (h *AdminHandler) RegisterRoutes(rg *gin.RouterGroup) {
	p := rg.Group("/pricing")
	{
		versions := p.Group("/versions")
		{
			versions.GET("", h.ListVersions)
			versions.POST("", h.CreateVersion)
			versions.GET("/:id", h.GetVersion)
			versions.PUT("/:id", h.UpdateVersion)
			versions.POST("/:id/activate", h.ActivateVersion)
			versions.POST("/:id/archive", h.ArchiveVersion)
			versions.POST("/:id/clone", h.CloneVersion)

			versions.GET("/:id/configs", h.ListConfigs)
			versions.POST("/:id/configs", h.CreateConfig)

			versions.GET("/:id/time-multipliers", h.ListTimeMultipliers)
			versions.POST("/:id/time-multipliers", h.CreateTimeMultiplier)

			versions.GET("/:id/weather-multipliers", h.ListWeatherMultipliers)
			versions.POST("/:id/weather-multipliers", h.CreateWeatherMultiplier)

			versions.GET("/:id/event-multipliers", h.ListEventMultipliers)
			versions.POST("/:id/event-multipliers", h.CreateEventMultiplier)

			versions.GET("/:id/zone-fees", h.ListZoneFees)
			versions.POST("/:id/zone-fees", h.CreateZoneFee)

			versions.GET("/:id/surge-thresholds", h.ListSurgeThresholds)
			versions.POST("/:id/surge-thresholds", h.CreateSurgeThreshold)
		}

		configs := p.Group("/configs")
		{
			configs.GET("/:id", h.GetConfig)
			configs.PUT("/:id", h.UpdateConfig)
			configs.DELETE("/:id", h.DeleteConfig)
		}

		timeMultipliers := p.Group("/time-multipliers")
		{
			timeMultipliers.GET("/:id", h.GetTimeMultiplier)
			timeMultipliers.PUT("/:id", h.UpdateTimeMultiplier)
			timeMultipliers.DELETE("/:id", h.DeleteTimeMultiplier)
		}

		weatherMultipliers := p.Group("/weather-multipliers")
		{
			weatherMultipliers.GET("/:id", h.GetWeatherMultiplier)
			weatherMultipliers.PUT("/:id", h.UpdateWeatherMultiplier)
			weatherMultipliers.DELETE("/:id", h.DeleteWeatherMultiplier)
		}

		eventMultipliers := p.Group("/event-multipliers")
		{
			eventMultipliers.GET("/:id", h.GetEventMultiplier)
			eventMultipliers.PUT("/:id", h.UpdateEventMultiplier)
			eventMultipliers.DELETE("/:id", h.DeleteEventMultiplier)
		}

		zoneFees := p.Group("/zone-fees")
		{
			zoneFees.GET("/:id", h.GetZoneFee)
			zoneFees.PUT("/:id", h.UpdateZoneFee)
			zoneFees.DELETE("/:id", h.DeleteZoneFee)
		}

		surgeThresholds := p.Group("/surge-thresholds")
		{
			surgeThresholds.GET("/:id", h.GetSurgeThreshold)
			surgeThresholds.PUT("/:id", h.UpdateSurgeThreshold)
			surgeThresholds.DELETE("/:id", h.DeleteSurgeThreshold)
		}

		p.GET("/audit-logs", h.GetAuditLogs)
	}
}

func (h *AdminHandler) ListVersions(c *gin.Context) {
	params := pagination.ParseParams(c)
	status := c.Query("status")

	versions, total, err := h.repo.ListVersions(c.Request.Context(), params.Limit, params.Offset, status)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to fetch versions")
		return
	}

	meta := pagination.BuildMeta(params.Limit, params.Offset, total)
	common.SuccessResponseWithMeta(c, versions, meta)
}

func (h *AdminHandler) CreateVersion(c *gin.Context) {
	var req CreateVersionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	adminID := getAdminID(c)
	version := &PricingConfigVersion{
		Name:           req.Name,
		Description:    req.Description,
		EffectiveFrom:  req.EffectiveFrom,
		EffectiveUntil: req.EffectiveUntil,
		CreatedBy:      &adminID,
	}

	if err := h.repo.CreateVersion(c.Request.Context(), version); err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to create version")
		return
	}

	h.repo.InsertPricingAuditLog(c.Request.Context(), adminID, "create_version", "pricing_config_version", version.ID, nil, nil, "")
	common.SuccessResponseWithStatus(c, http.StatusCreated, version, "Version created successfully")
}

func (h *AdminHandler) GetVersion(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid version ID")
		return
	}

	version, err := h.repo.GetVersionByID(c.Request.Context(), id)
	if err != nil {
		common.ErrorResponse(c, http.StatusNotFound, "Version not found")
		return
	}

	common.SuccessResponse(c, version)
}

func (h *AdminHandler) UpdateVersion(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid version ID")
		return
	}

	version, err := h.repo.GetVersionByID(c.Request.Context(), id)
	if err != nil {
		common.ErrorResponse(c, http.StatusNotFound, "Version not found")
		return
	}

	if version.Status != VersionStatusDraft {
		common.ErrorResponse(c, http.StatusBadRequest, "Only draft versions can be updated")
		return
	}

	var req UpdateVersionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	if req.Name != nil {
		version.Name = *req.Name
	}
	if req.Description != nil {
		version.Description = req.Description
	}
	if req.EffectiveFrom != nil {
		version.EffectiveFrom = req.EffectiveFrom
	}
	if req.EffectiveUntil != nil {
		version.EffectiveUntil = req.EffectiveUntil
	}

	if err := h.repo.UpdateVersion(c.Request.Context(), version); err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to update version")
		return
	}

	h.repo.InsertPricingAuditLog(c.Request.Context(), getAdminID(c), "update_version", "pricing_config_version", id, nil, nil, "")
	common.SuccessResponse(c, version)
}

func (h *AdminHandler) ActivateVersion(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid version ID")
		return
	}

	adminID := getAdminID(c)
	if err := h.repo.ActivateVersion(c.Request.Context(), id, adminID); err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to activate version")
		return
	}

	h.repo.InsertPricingAuditLog(c.Request.Context(), adminID, "activate_version", "pricing_config_version", id, nil, nil, "")
	common.SuccessResponseWithStatus(c, http.StatusOK, nil, "Version activated successfully")
}

func (h *AdminHandler) ArchiveVersion(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid version ID")
		return
	}

	if err := h.repo.ArchiveVersion(c.Request.Context(), id); err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to archive version")
		return
	}

	h.repo.InsertPricingAuditLog(c.Request.Context(), getAdminID(c), "archive_version", "pricing_config_version", id, nil, nil, "")
	common.SuccessResponseWithStatus(c, http.StatusOK, nil, "Version archived successfully")
}

func (h *AdminHandler) CloneVersion(c *gin.Context) {
	sourceID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid version ID")
		return
	}

	var req CloneVersionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	adminID := getAdminID(c)
	newVersion, err := h.repo.CloneVersion(c.Request.Context(), sourceID, req.Name, adminID)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to clone version")
		return
	}

	h.repo.InsertPricingAuditLog(c.Request.Context(), adminID, "clone_version", "pricing_config_version", newVersion.ID, nil, nil, "")
	common.SuccessResponseWithStatus(c, http.StatusCreated, newVersion, "Version cloned successfully")
}

func (h *AdminHandler) ListConfigs(c *gin.Context) {
	versionID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid version ID")
		return
	}

	params := pagination.ParseParams(c)
	configs, total, err := h.repo.ListConfigs(c.Request.Context(), versionID, params.Limit, params.Offset)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to fetch configs")
		return
	}

	meta := pagination.BuildMeta(params.Limit, params.Offset, total)
	common.SuccessResponseWithMeta(c, configs, meta)
}

func (h *AdminHandler) CreateConfig(c *gin.Context) {
	versionID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid version ID")
		return
	}

	var req CreateConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	config := &PricingConfig{
		VersionID:             versionID,
		CountryID:             req.CountryID,
		RegionID:              req.RegionID,
		CityID:                req.CityID,
		ZoneID:                req.ZoneID,
		RideTypeID:            req.RideTypeID,
		BaseFare:              req.BaseFare,
		PerKmRate:             req.PerKmRate,
		PerMinuteRate:         req.PerMinuteRate,
		MinimumFare:           req.MinimumFare,
		BookingFee:            req.BookingFee,
		PlatformCommissionPct: req.PlatformCommissionPct,
		DriverIncentivePct:    req.DriverIncentivePct,
		SurgeMinMultiplier:    req.SurgeMinMultiplier,
		SurgeMaxMultiplier:    req.SurgeMaxMultiplier,
		TaxRatePct:            req.TaxRatePct,
		TaxInclusive:          req.TaxInclusive,
		CancellationFees:      req.CancellationFees,
		IsActive:              req.IsActive,
	}

	if err := h.repo.CreateConfig(c.Request.Context(), config); err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to create config")
		return
	}

	h.repo.InsertPricingAuditLog(c.Request.Context(), getAdminID(c), "create_config", "pricing_config", config.ID, nil, nil, "")
	common.SuccessResponseWithStatus(c, http.StatusCreated, config, "Config created successfully")
}

func (h *AdminHandler) GetConfig(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid config ID")
		return
	}

	config, err := h.repo.GetConfigByID(c.Request.Context(), id)
	if err != nil {
		common.ErrorResponse(c, http.StatusNotFound, "Config not found")
		return
	}

	common.SuccessResponse(c, config)
}

func (h *AdminHandler) UpdateConfig(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid config ID")
		return
	}

	existing, err := h.repo.GetConfigByID(c.Request.Context(), id)
	if err != nil {
		common.ErrorResponse(c, http.StatusNotFound, "Config not found")
		return
	}

	var req UpdateConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	existing.CountryID = req.CountryID
	existing.RegionID = req.RegionID
	existing.CityID = req.CityID
	existing.ZoneID = req.ZoneID
	existing.RideTypeID = req.RideTypeID
	existing.BaseFare = req.BaseFare
	existing.PerKmRate = req.PerKmRate
	existing.PerMinuteRate = req.PerMinuteRate
	existing.MinimumFare = req.MinimumFare
	existing.BookingFee = req.BookingFee
	existing.PlatformCommissionPct = req.PlatformCommissionPct
	existing.DriverIncentivePct = req.DriverIncentivePct
	existing.SurgeMinMultiplier = req.SurgeMinMultiplier
	existing.SurgeMaxMultiplier = req.SurgeMaxMultiplier
	existing.TaxRatePct = req.TaxRatePct
	existing.TaxInclusive = req.TaxInclusive
	existing.CancellationFees = req.CancellationFees
	existing.IsActive = req.IsActive

	if err := h.repo.UpdateConfig(c.Request.Context(), existing); err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to update config")
		return
	}

	h.repo.InsertPricingAuditLog(c.Request.Context(), getAdminID(c), "update_config", "pricing_config", id, nil, nil, "")
	common.SuccessResponse(c, existing)
}

func (h *AdminHandler) DeleteConfig(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid config ID")
		return
	}

	if err := h.repo.DeleteConfig(c.Request.Context(), id); err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to delete config")
		return
	}

	h.repo.InsertPricingAuditLog(c.Request.Context(), getAdminID(c), "delete_config", "pricing_config", id, nil, nil, "")
	common.SuccessResponseWithStatus(c, http.StatusOK, nil, "Config deleted successfully")
}

func (h *AdminHandler) ListTimeMultipliers(c *gin.Context) {
	versionID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid version ID")
		return
	}

	params := pagination.ParseParams(c)
	items, total, err := h.repo.ListTimeMultipliersByVersion(c.Request.Context(), versionID, params.Limit, params.Offset)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to fetch time multipliers")
		return
	}

	meta := pagination.BuildMeta(params.Limit, params.Offset, total)
	common.SuccessResponseWithMeta(c, items, meta)
}

func (h *AdminHandler) CreateTimeMultiplier(c *gin.Context) {
	versionID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid version ID")
		return
	}

	var req CreateTimeMultiplierRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	m := &TimeMultiplier{
		VersionID:  versionID,
		CountryID:  req.CountryID,
		RegionID:   req.RegionID,
		CityID:     req.CityID,
		Name:       req.Name,
		DaysOfWeek: req.DaysOfWeek,
		StartTime:  req.StartTime,
		EndTime:    req.EndTime,
		Multiplier: req.Multiplier,
		Priority:   req.Priority,
		IsActive:   req.IsActive,
	}

	if err := h.repo.CreateTimeMultiplier(c.Request.Context(), m); err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to create time multiplier")
		return
	}

	h.repo.InsertPricingAuditLog(c.Request.Context(), getAdminID(c), "create_time_multiplier", "time_multiplier", m.ID, nil, nil, "")
	common.SuccessResponseWithStatus(c, http.StatusCreated, m, "Time multiplier created successfully")
}

func (h *AdminHandler) GetTimeMultiplier(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid time multiplier ID")
		return
	}

	m, err := h.repo.GetTimeMultiplierByID(c.Request.Context(), id)
	if err != nil {
		common.ErrorResponse(c, http.StatusNotFound, "Time multiplier not found")
		return
	}

	common.SuccessResponse(c, m)
}

func (h *AdminHandler) UpdateTimeMultiplier(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid time multiplier ID")
		return
	}

	existing, err := h.repo.GetTimeMultiplierByID(c.Request.Context(), id)
	if err != nil {
		common.ErrorResponse(c, http.StatusNotFound, "Time multiplier not found")
		return
	}

	var req UpdateTimeMultiplierRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	existing.CountryID = req.CountryID
	existing.RegionID = req.RegionID
	existing.CityID = req.CityID
	existing.Name = req.Name
	existing.DaysOfWeek = req.DaysOfWeek
	existing.StartTime = req.StartTime
	existing.EndTime = req.EndTime
	existing.Multiplier = req.Multiplier
	existing.Priority = req.Priority
	existing.IsActive = req.IsActive

	if err := h.repo.UpdateTimeMultiplier(c.Request.Context(), existing); err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to update time multiplier")
		return
	}

	h.repo.InsertPricingAuditLog(c.Request.Context(), getAdminID(c), "update_time_multiplier", "time_multiplier", id, nil, nil, "")
	common.SuccessResponse(c, existing)
}

func (h *AdminHandler) DeleteTimeMultiplier(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid time multiplier ID")
		return
	}

	if err := h.repo.DeleteTimeMultiplier(c.Request.Context(), id); err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to delete time multiplier")
		return
	}

	h.repo.InsertPricingAuditLog(c.Request.Context(), getAdminID(c), "delete_time_multiplier", "time_multiplier", id, nil, nil, "")
	common.SuccessResponseWithStatus(c, http.StatusOK, nil, "Time multiplier deleted successfully")
}

func (h *AdminHandler) ListWeatherMultipliers(c *gin.Context) {
	versionID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid version ID")
		return
	}

	params := pagination.ParseParams(c)
	items, total, err := h.repo.ListWeatherMultipliersByVersion(c.Request.Context(), versionID, params.Limit, params.Offset)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to fetch weather multipliers")
		return
	}

	meta := pagination.BuildMeta(params.Limit, params.Offset, total)
	common.SuccessResponseWithMeta(c, items, meta)
}

func (h *AdminHandler) CreateWeatherMultiplier(c *gin.Context) {
	versionID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid version ID")
		return
	}

	var req CreateWeatherMultiplierRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	m := &WeatherMultiplier{
		VersionID:        versionID,
		CountryID:        req.CountryID,
		RegionID:         req.RegionID,
		CityID:           req.CityID,
		WeatherCondition: req.WeatherCondition,
		Multiplier:       req.Multiplier,
		IsActive:         req.IsActive,
	}

	if err := h.repo.CreateWeatherMultiplier(c.Request.Context(), m); err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to create weather multiplier")
		return
	}

	h.repo.InsertPricingAuditLog(c.Request.Context(), getAdminID(c), "create_weather_multiplier", "weather_multiplier", m.ID, nil, nil, "")
	common.SuccessResponseWithStatus(c, http.StatusCreated, m, "Weather multiplier created successfully")
}

func (h *AdminHandler) GetWeatherMultiplier(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid weather multiplier ID")
		return
	}

	m, err := h.repo.GetWeatherMultiplierByID(c.Request.Context(), id)
	if err != nil {
		common.ErrorResponse(c, http.StatusNotFound, "Weather multiplier not found")
		return
	}

	common.SuccessResponse(c, m)
}

func (h *AdminHandler) UpdateWeatherMultiplier(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid weather multiplier ID")
		return
	}

	existing, err := h.repo.GetWeatherMultiplierByID(c.Request.Context(), id)
	if err != nil {
		common.ErrorResponse(c, http.StatusNotFound, "Weather multiplier not found")
		return
	}

	var req UpdateWeatherMultiplierRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	existing.CountryID = req.CountryID
	existing.RegionID = req.RegionID
	existing.CityID = req.CityID
	existing.WeatherCondition = req.WeatherCondition
	existing.Multiplier = req.Multiplier
	existing.IsActive = req.IsActive

	if err := h.repo.UpdateWeatherMultiplier(c.Request.Context(), existing); err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to update weather multiplier")
		return
	}

	h.repo.InsertPricingAuditLog(c.Request.Context(), getAdminID(c), "update_weather_multiplier", "weather_multiplier", id, nil, nil, "")
	common.SuccessResponse(c, existing)
}

func (h *AdminHandler) DeleteWeatherMultiplier(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid weather multiplier ID")
		return
	}

	if err := h.repo.DeleteWeatherMultiplier(c.Request.Context(), id); err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to delete weather multiplier")
		return
	}

	h.repo.InsertPricingAuditLog(c.Request.Context(), getAdminID(c), "delete_weather_multiplier", "weather_multiplier", id, nil, nil, "")
	common.SuccessResponseWithStatus(c, http.StatusOK, nil, "Weather multiplier deleted successfully")
}

func (h *AdminHandler) ListEventMultipliers(c *gin.Context) {
	versionID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid version ID")
		return
	}

	params := pagination.ParseParams(c)
	items, total, err := h.repo.ListEventMultipliersByVersion(c.Request.Context(), versionID, params.Limit, params.Offset)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to fetch event multipliers")
		return
	}

	meta := pagination.BuildMeta(params.Limit, params.Offset, total)
	common.SuccessResponseWithMeta(c, items, meta)
}

func (h *AdminHandler) CreateEventMultiplier(c *gin.Context) {
	versionID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid version ID")
		return
	}

	var req CreateEventMultiplierRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	m := &EventMultiplier{
		VersionID:              versionID,
		ZoneID:                 req.ZoneID,
		CityID:                 req.CityID,
		EventName:              req.EventName,
		EventType:              req.EventType,
		StartsAt:               req.StartsAt,
		EndsAt:                 req.EndsAt,
		PreEventMinutes:        req.PreEventMinutes,
		PostEventMinutes:       req.PostEventMinutes,
		Multiplier:             req.Multiplier,
		ExpectedDemandIncrease: req.ExpectedDemandIncrease,
		IsActive:               req.IsActive,
	}

	if err := h.repo.CreateEventMultiplier(c.Request.Context(), m); err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to create event multiplier")
		return
	}

	h.repo.InsertPricingAuditLog(c.Request.Context(), getAdminID(c), "create_event_multiplier", "event_multiplier", m.ID, nil, nil, "")
	common.SuccessResponseWithStatus(c, http.StatusCreated, m, "Event multiplier created successfully")
}

func (h *AdminHandler) GetEventMultiplier(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid event multiplier ID")
		return
	}

	m, err := h.repo.GetEventMultiplierByID(c.Request.Context(), id)
	if err != nil {
		common.ErrorResponse(c, http.StatusNotFound, "Event multiplier not found")
		return
	}

	common.SuccessResponse(c, m)
}

func (h *AdminHandler) UpdateEventMultiplier(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid event multiplier ID")
		return
	}

	existing, err := h.repo.GetEventMultiplierByID(c.Request.Context(), id)
	if err != nil {
		common.ErrorResponse(c, http.StatusNotFound, "Event multiplier not found")
		return
	}

	var req UpdateEventMultiplierRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	existing.ZoneID = req.ZoneID
	existing.CityID = req.CityID
	existing.EventName = req.EventName
	existing.EventType = req.EventType
	existing.StartsAt = req.StartsAt
	existing.EndsAt = req.EndsAt
	existing.PreEventMinutes = req.PreEventMinutes
	existing.PostEventMinutes = req.PostEventMinutes
	existing.Multiplier = req.Multiplier
	existing.ExpectedDemandIncrease = req.ExpectedDemandIncrease
	existing.IsActive = req.IsActive

	if err := h.repo.UpdateEventMultiplier(c.Request.Context(), existing); err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to update event multiplier")
		return
	}

	h.repo.InsertPricingAuditLog(c.Request.Context(), getAdminID(c), "update_event_multiplier", "event_multiplier", id, nil, nil, "")
	common.SuccessResponse(c, existing)
}

func (h *AdminHandler) DeleteEventMultiplier(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid event multiplier ID")
		return
	}

	if err := h.repo.DeleteEventMultiplier(c.Request.Context(), id); err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to delete event multiplier")
		return
	}

	h.repo.InsertPricingAuditLog(c.Request.Context(), getAdminID(c), "delete_event_multiplier", "event_multiplier", id, nil, nil, "")
	common.SuccessResponseWithStatus(c, http.StatusOK, nil, "Event multiplier deleted successfully")
}

func (h *AdminHandler) ListZoneFees(c *gin.Context) {
	versionID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid version ID")
		return
	}

	params := pagination.ParseParams(c)
	var zoneID *uuid.UUID
	if zoneIDStr := c.Query("zone_id"); zoneIDStr != "" {
		if id, err := uuid.Parse(zoneIDStr); err == nil {
			zoneID = &id
		}
	}

	items, total, err := h.repo.ListZoneFeesByVersion(c.Request.Context(), versionID, zoneID, params.Limit, params.Offset)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to fetch zone fees")
		return
	}

	meta := pagination.BuildMeta(params.Limit, params.Offset, total)
	common.SuccessResponseWithMeta(c, items, meta)
}

func (h *AdminHandler) CreateZoneFee(c *gin.Context) {
	versionID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid version ID")
		return
	}

	var req CreateZoneFeeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	fee := &ZoneFee{
		ZoneID:         req.ZoneID,
		VersionID:      versionID,
		FeeType:        req.FeeType,
		RideTypeID:     req.RideTypeID,
		Amount:         req.Amount,
		IsPercentage:   req.IsPercentage,
		AppliesPickup:  req.AppliesPickup,
		AppliesDropoff: req.AppliesDropoff,
		Schedule:       req.Schedule,
		IsActive:       req.IsActive,
	}

	if err := h.repo.CreateZoneFee(c.Request.Context(), fee); err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to create zone fee")
		return
	}

	h.repo.InsertPricingAuditLog(c.Request.Context(), getAdminID(c), "create_zone_fee", "zone_fee", fee.ID, nil, nil, "")
	common.SuccessResponseWithStatus(c, http.StatusCreated, fee, "Zone fee created successfully")
}

func (h *AdminHandler) GetZoneFee(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid zone fee ID")
		return
	}

	fee, err := h.repo.GetZoneFeeByID(c.Request.Context(), id)
	if err != nil {
		common.ErrorResponse(c, http.StatusNotFound, "Zone fee not found")
		return
	}

	common.SuccessResponse(c, fee)
}

func (h *AdminHandler) UpdateZoneFee(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid zone fee ID")
		return
	}

	existing, err := h.repo.GetZoneFeeByID(c.Request.Context(), id)
	if err != nil {
		common.ErrorResponse(c, http.StatusNotFound, "Zone fee not found")
		return
	}

	var req UpdateZoneFeeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	existing.ZoneID = req.ZoneID
	existing.FeeType = req.FeeType
	existing.RideTypeID = req.RideTypeID
	existing.Amount = req.Amount
	existing.IsPercentage = req.IsPercentage
	existing.AppliesPickup = req.AppliesPickup
	existing.AppliesDropoff = req.AppliesDropoff
	existing.Schedule = req.Schedule
	existing.IsActive = req.IsActive

	if err := h.repo.UpdateZoneFee(c.Request.Context(), existing); err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to update zone fee")
		return
	}

	h.repo.InsertPricingAuditLog(c.Request.Context(), getAdminID(c), "update_zone_fee", "zone_fee", id, nil, nil, "")
	common.SuccessResponse(c, existing)
}

func (h *AdminHandler) DeleteZoneFee(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid zone fee ID")
		return
	}

	if err := h.repo.DeleteZoneFee(c.Request.Context(), id); err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to delete zone fee")
		return
	}

	h.repo.InsertPricingAuditLog(c.Request.Context(), getAdminID(c), "delete_zone_fee", "zone_fee", id, nil, nil, "")
	common.SuccessResponseWithStatus(c, http.StatusOK, nil, "Zone fee deleted successfully")
}

func (h *AdminHandler) ListSurgeThresholds(c *gin.Context) {
	versionID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid version ID")
		return
	}

	params := pagination.ParseParams(c)
	items, total, err := h.repo.ListSurgeThresholdsByVersion(c.Request.Context(), versionID, params.Limit, params.Offset)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to fetch surge thresholds")
		return
	}

	meta := pagination.BuildMeta(params.Limit, params.Offset, total)
	common.SuccessResponseWithMeta(c, items, meta)
}

func (h *AdminHandler) CreateSurgeThreshold(c *gin.Context) {
	versionID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid version ID")
		return
	}

	var req CreateSurgeThresholdRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	t := &SurgeThreshold{
		VersionID:            versionID,
		CountryID:            req.CountryID,
		RegionID:             req.RegionID,
		CityID:               req.CityID,
		DemandSupplyRatioMin: req.DemandSupplyRatioMin,
		DemandSupplyRatioMax: req.DemandSupplyRatioMax,
		Multiplier:           req.Multiplier,
		IsActive:             req.IsActive,
	}

	if err := h.repo.CreateSurgeThreshold(c.Request.Context(), t); err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to create surge threshold")
		return
	}

	h.repo.InsertPricingAuditLog(c.Request.Context(), getAdminID(c), "create_surge_threshold", "surge_threshold", t.ID, nil, nil, "")
	common.SuccessResponseWithStatus(c, http.StatusCreated, t, "Surge threshold created successfully")
}

func (h *AdminHandler) GetSurgeThreshold(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid surge threshold ID")
		return
	}

	t, err := h.repo.GetSurgeThresholdByID(c.Request.Context(), id)
	if err != nil {
		common.ErrorResponse(c, http.StatusNotFound, "Surge threshold not found")
		return
	}

	common.SuccessResponse(c, t)
}

func (h *AdminHandler) UpdateSurgeThreshold(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid surge threshold ID")
		return
	}

	existing, err := h.repo.GetSurgeThresholdByID(c.Request.Context(), id)
	if err != nil {
		common.ErrorResponse(c, http.StatusNotFound, "Surge threshold not found")
		return
	}

	var req UpdateSurgeThresholdRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, err.Error())
		return
	}

	existing.CountryID = req.CountryID
	existing.RegionID = req.RegionID
	existing.CityID = req.CityID
	existing.DemandSupplyRatioMin = req.DemandSupplyRatioMin
	existing.DemandSupplyRatioMax = req.DemandSupplyRatioMax
	existing.Multiplier = req.Multiplier
	existing.IsActive = req.IsActive

	if err := h.repo.UpdateSurgeThreshold(c.Request.Context(), existing); err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to update surge threshold")
		return
	}

	h.repo.InsertPricingAuditLog(c.Request.Context(), getAdminID(c), "update_surge_threshold", "surge_threshold", id, nil, nil, "")
	common.SuccessResponse(c, existing)
}

func (h *AdminHandler) DeleteSurgeThreshold(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "Invalid surge threshold ID")
		return
	}

	if err := h.repo.DeleteSurgeThreshold(c.Request.Context(), id); err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to delete surge threshold")
		return
	}

	h.repo.InsertPricingAuditLog(c.Request.Context(), getAdminID(c), "delete_surge_threshold", "surge_threshold", id, nil, nil, "")
	common.SuccessResponseWithStatus(c, http.StatusOK, nil, "Surge threshold deleted successfully")
}

func (h *AdminHandler) GetAuditLogs(c *gin.Context) {
	params := pagination.ParseParams(c)
	entityType := c.Query("entity_type")

	var entityID *uuid.UUID
	if eidStr := c.Query("entity_id"); eidStr != "" {
		if id, err := uuid.Parse(eidStr); err == nil {
			entityID = &id
		}
	}

	logs, total, err := h.repo.GetPricingAuditLogs(c.Request.Context(), entityType, entityID, params.Limit, params.Offset)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "Failed to fetch audit logs")
		return
	}

	meta := pagination.BuildMeta(params.Limit, params.Offset, total)
	common.SuccessResponseWithMeta(c, logs, meta)
}
