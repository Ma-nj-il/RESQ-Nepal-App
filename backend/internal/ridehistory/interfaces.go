package ridehistory

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// RepositoryInterface defines the interface for ride history repository operations
type RepositoryInterface interface {
	GetRiderHistory(ctx context.Context, riderID uuid.UUID, filters *HistoryFilters, limit, offset int) ([]RideHistoryEntry, int, error)
	GetDriverHistory(ctx context.Context, driverID uuid.UUID, filters *HistoryFilters, limit, offset int) ([]RideHistoryEntry, int, error)
	GetRideByID(ctx context.Context, rideID uuid.UUID) (*RideHistoryEntry, error)
	GetRiderStats(ctx context.Context, riderID uuid.UUID, from, to time.Time) (*RideStats, error)
	GetFrequentRoutes(ctx context.Context, riderID uuid.UUID, limit int) ([]FrequentRoute, error)
}
