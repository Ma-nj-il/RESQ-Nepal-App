package pool

import (
	"net/http"

	"github.com/bikky-kc013/medi-ambulance/pkg/common"
	"github.com/bikky-kc013/medi-ambulance/pkg/jwtkeys"
	"github.com/bikky-kc013/medi-ambulance/pkg/middleware"
	"github.com/bikky-kc013/medi-ambulance/pkg/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// Handler handles HTTP requests for pool rides
type Handler struct {
	service *Service
}

// NewHandler creates a new pool handler
func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

// ========================================
// RIDER ENDPOINTS
// ========================================

// RequestPoolRide requests a pool ride
// POST /api/v1/pool/request
func (h *Handler) RequestPoolRide(c *gin.Context) {
	riderID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req RequestPoolRideRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid request body")
		return
	}

	result, err := h.service.RequestPoolRide(c.Request.Context(), riderID, &req)
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to request pool ride")
		return
	}

	common.SuccessResponse(c, result)
}

// ConfirmPoolRide confirms or declines joining a pool
// POST /api/v1/pool/confirm
func (h *Handler) ConfirmPoolRide(c *gin.Context) {
	riderID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req ConfirmPoolRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := h.service.ConfirmPoolRide(c.Request.Context(), riderID, &req); err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to confirm pool")
		return
	}

	common.SuccessResponse(c, gin.H{
		"message": "Pool ride " + map[bool]string{true: "confirmed", false: "declined"}[req.Accept],
	})
}

// GetPoolStatus gets the status of a pool ride
// GET /api/v1/pool/:id
func (h *Handler) GetPoolStatus(c *gin.Context) {
	riderID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	poolRideID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid pool ride ID")
		return
	}

	result, err := h.service.GetPoolStatus(c.Request.Context(), riderID, poolRideID)
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusNotFound, "pool ride not found")
		return
	}

	common.SuccessResponse(c, result)
}

// CancelPoolRide cancels a pool ride
// POST /api/v1/pool/:id/cancel
func (h *Handler) CancelPoolRide(c *gin.Context) {
	riderID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	poolPassengerID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid pool passenger ID")
		return
	}

	if err := h.service.CancelPoolRide(c.Request.Context(), riderID, poolPassengerID); err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to cancel pool ride")
		return
	}

	common.SuccessResponse(c, gin.H{
		"message": "Pool ride cancelled successfully",
	})
}

// GetActivePool gets the rider's active pool ride
// GET /api/v1/pool/active
func (h *Handler) GetActivePool(c *gin.Context) {
	riderID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	passenger, err := h.service.repo.GetActivePassengerForRider(c.Request.Context(), riderID)
	if err != nil {
		common.SuccessResponse(c, gin.H{
			"active_pool": nil,
			"message":     "No active pool ride",
		})
		return
	}

	poolStatus, err := h.service.GetPoolStatus(c.Request.Context(), riderID, passenger.PoolRideID)
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get pool status")
		return
	}

	common.SuccessResponse(c, gin.H{
		"active_pool":  poolStatus,
		"passenger_id": passenger.ID,
		"my_fare":      passenger.PoolFare,
		"savings":      passenger.SavingsPercent,
	})
}

// ========================================
// DRIVER ENDPOINTS
// ========================================

// GetDriverPool gets the current pool ride for the driver
// GET /api/v1/driver/pool
func (h *Handler) GetDriverPool(c *gin.Context) {
	driverID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	result, err := h.service.GetDriverPoolRide(c.Request.Context(), driverID)
	if err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.SuccessResponse(c, gin.H{
			"active_pool": nil,
			"message":     "No active pool ride",
		})
		return
	}

	common.SuccessResponse(c, result)
}

// StartPoolRide starts the pool ride
// POST /api/v1/driver/pool/:id/start
func (h *Handler) StartPoolRide(c *gin.Context) {
	driverID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	poolRideID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid pool ride ID")
		return
	}

	if err := h.service.StartPoolRide(c.Request.Context(), driverID, poolRideID); err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to start pool ride")
		return
	}

	common.SuccessResponse(c, gin.H{
		"message": "Pool ride started",
	})
}

// PickupPassenger marks a passenger as picked up
// POST /api/v1/driver/pool/passenger/:id/pickup
func (h *Handler) PickupPassenger(c *gin.Context) {
	driverID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	passengerID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid passenger ID")
		return
	}

	if err := h.service.PickupPassenger(c.Request.Context(), driverID, passengerID); err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to pickup passenger")
		return
	}

	common.SuccessResponse(c, gin.H{
		"message": "Passenger picked up",
	})
}

// DropoffPassenger marks a passenger as dropped off
// POST /api/v1/driver/pool/passenger/:id/dropoff
func (h *Handler) DropoffPassenger(c *gin.Context) {
	driverID, err := middleware.GetUserID(c)
	if err != nil {
		common.ErrorResponse(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	passengerID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		common.ErrorResponse(c, http.StatusBadRequest, "invalid passenger ID")
		return
	}

	if err := h.service.DropoffPassenger(c.Request.Context(), driverID, passengerID); err != nil {
		if appErr, ok := err.(*common.AppError); ok {
			common.AppErrorResponse(c, appErr)
			return
		}
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to dropoff passenger")
		return
	}

	common.SuccessResponse(c, gin.H{
		"message": "Passenger dropped off",
	})
}

// ========================================
// ADMIN ENDPOINTS
// ========================================

// GetPoolStats gets pool ride statistics
// GET /api/v1/admin/pool/stats
func (h *Handler) GetPoolStats(c *gin.Context) {
	stats, err := h.service.GetPoolStats(c.Request.Context())
	if err != nil {
		common.ErrorResponse(c, http.StatusInternalServerError, "failed to get pool statistics")
		return
	}

	common.SuccessResponse(c, stats)
}

// ========================================
// ROUTE REGISTRATION
// ========================================

// RegisterRoutes registers pool routes
func (h *Handler) RegisterRoutes(r *gin.Engine, jwtProvider jwtkeys.KeyProvider) {
	// Rider pool routes
	pool := r.Group("/api/v1/pool")
	pool.Use(middleware.AuthMiddlewareWithProvider(jwtProvider))
	{
		pool.POST("/request", h.RequestPoolRide)
		pool.POST("/confirm", h.ConfirmPoolRide)
		pool.GET("/active", h.GetActivePool)
		pool.GET("/:id", h.GetPoolStatus)
		pool.POST("/:id/cancel", h.CancelPoolRide)
	}

	// Driver pool routes
	driverPool := r.Group("/api/v1/driver/pool")
	driverPool.Use(middleware.AuthMiddlewareWithProvider(jwtProvider))
	driverPool.Use(middleware.RequireRole(models.RoleDriver))
	{
		driverPool.GET("", h.GetDriverPool)
		driverPool.POST("/:id/start", h.StartPoolRide)
		driverPool.POST("/passenger/:id/pickup", h.PickupPassenger)
		driverPool.POST("/passenger/:id/dropoff", h.DropoffPassenger)
	}

	// Admin routes
	admin := r.Group("/api/v1/admin/pool")
	admin.Use(middleware.AuthMiddlewareWithProvider(jwtProvider))
	admin.Use(middleware.RequireRole(models.RoleAdmin))
	{
		admin.GET("/stats", h.GetPoolStats)
	}
}

// RegisterRoutesOnGroup registers pool routes on an existing router group
func (h *Handler) RegisterRoutesOnGroup(rg *gin.RouterGroup) {
	pool := rg.Group("/pool")
	{
		pool.POST("/request", h.RequestPoolRide)
		pool.POST("/confirm", h.ConfirmPoolRide)
		pool.GET("/active", h.GetActivePool)
		pool.GET("/:id", h.GetPoolStatus)
		pool.POST("/:id/cancel", h.CancelPoolRide)
	}
}
