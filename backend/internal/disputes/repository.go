package disputes

import (
	"context"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/database"
	"github.com/google/uuid"
)

type Repository struct {
	db *database.DBPool
}

func NewRepository(db *database.DBPool) *Repository {
	return &Repository{db: db}
}

func (r *Repository) CreateDispute(ctx context.Context, d *Dispute) error {
	return r.db.Primary.WithContext(ctx).Create(d).Error
}

func (r *Repository) GetDisputeByID(ctx context.Context, id uuid.UUID) (*Dispute, error) {
	var d Dispute
	err := r.db.Primary.WithContext(ctx).First(&d, "id = ?", id).Error
	if err != nil {
		return nil, err
	}
	return &d, nil
}

func (r *Repository) GetDisputeByRideAndUser(ctx context.Context, rideID, userID uuid.UUID) (*Dispute, error) {
	var d Dispute
	err := r.db.Primary.WithContext(ctx).
		Where("ride_id = ? AND user_id = ? AND status NOT IN (?)", rideID, userID, []DisputeStatus{DisputeStatusClosed, DisputeStatusRejected}).
		First(&d).Error
	if err != nil {
		return nil, err
	}
	return &d, nil
}

func (r *Repository) GetUserDisputes(ctx context.Context, userID uuid.UUID, status *DisputeStatus, limit, offset int) ([]DisputeSummary, int, error) {
	var total int64
	query := r.db.Primary.WithContext(ctx).Model(&Dispute{}).Where("user_id = ?", userID)

	if status != nil {
		query = query.Where("status = ?", *status)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var disputes []DisputeSummary
	err := query.Order("created_at DESC").Limit(limit).Offset(offset).Scan(&disputes).Error
	return disputes, int(total), err
}

func (r *Repository) ResolveDispute(ctx context.Context, id uuid.UUID, status DisputeStatus, resType ResolutionType, refundAmount *float64, note string, resolvedBy uuid.UUID) error {
	now := time.Now()
	updates := map[string]interface{}{
		"status":          status,
		"resolution_type": resType,
		"refund_amount":   refundAmount,
		"resolution_note": note,
		"resolved_by":     resolvedBy,
		"resolved_at":     now,
		"updated_at":      now,
	}
	return r.db.Primary.WithContext(ctx).Model(&Dispute{}).Where("id = ?", id).Updates(updates).Error
}

func (r *Repository) UpdateDisputeStatus(ctx context.Context, id uuid.UUID, status DisputeStatus) error {
	return r.db.Primary.WithContext(ctx).Model(&Dispute{}).Where("id = ?", id).Updates(map[string]interface{}{
		"status":     status,
		"updated_at": time.Now(),
	}).Error
}

func (r *Repository) CreateComment(ctx context.Context, c *DisputeComment) error {
	return r.db.Primary.WithContext(ctx).Create(c).Error
}

func (r *Repository) GetCommentsByDispute(ctx context.Context, disputeID uuid.UUID, includeInternal bool) ([]DisputeComment, error) {
	var comments []DisputeComment
	query := r.db.Primary.WithContext(ctx).Where("dispute_id = ?", disputeID)

	if !includeInternal {
		query = query.Where("is_internal = ?", false)
	}

	err := query.Order("created_at ASC").Find(&comments).Error
	return comments, err
}

func (r *Repository) GetRideContext(ctx context.Context, rideID uuid.UUID) (*RideContext, error) {
	var rc RideContext
	err := r.db.Primary.WithContext(ctx).Table("rides").
		Select(`
			id as ride_id, estimated_fare, final_fare, estimated_distance as estimated_distance_km, actual_distance as actual_distance_km,
			estimated_duration as estimated_duration_min, actual_duration as actual_duration_min, surge_multiplier,
			pickup_address, dropoff_address, requested_at, completed_at
		`).
		Where("id = ?", rideID).
		Scan(&rc).Error
	if err != nil {
		return nil, err
	}
	return &rc, nil
}

func (r *Repository) GetAllDisputes(ctx context.Context, status *DisputeStatus, reason *DisputeReason, limit, offset int) ([]DisputeSummary, int, error) {
	var total int64
	query := r.db.Primary.WithContext(ctx).Model(&Dispute{})

	if status != nil {
		query = query.Where("status = ?", *status)
	}
	if reason != nil {
		query = query.Where("reason = ?", *reason)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var disputes []DisputeSummary
	err := query.Order("created_at DESC").Limit(limit).Offset(offset).Scan(&disputes).Error
	return disputes, int(total), err
}

func (r *Repository) GetDisputeStats(ctx context.Context, from, to time.Time) (*DisputeStats, error) {
	stats := &DisputeStats{}

	err := r.db.Primary.WithContext(ctx).Table("fare_disputes").
		Select(`
			COUNT(*) as total_disputes,
			COUNT(*) FILTER (WHERE status = 'pending') as pending_disputes,
			COUNT(*) FILTER (WHERE status = 'reviewing') as reviewing_disputes,
			COUNT(*) FILTER (WHERE status IN ('approved', 'partial_refund')) as approved_disputes,
			COUNT(*) FILTER (WHERE status = 'rejected') as rejected_disputes,
			COALESCE(SUM(CASE WHEN refund_amount IS NOT NULL THEN refund_amount ELSE 0 END), 0) as total_refunded,
			COALESCE(SUM(disputed_amount), 0) as total_disputed,
			COALESCE(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600) FILTER (WHERE resolved_at IS NOT NULL), 0) as avg_resolution_hours
		`).
		Where("created_at >= ? AND created_at < ?", from, to).
		Scan(stats).Error

	if err != nil {
		return nil, err
	}

	var totalRides int64
	r.db.Primary.WithContext(ctx).Table("rides").
		Where("created_at >= ? AND created_at < ?", from, to).
		Count(&totalRides)
	if totalRides > 0 {
		stats.DisputeRate = float64(stats.TotalDisputes) / float64(totalRides) * 100
	}

	type reasonCnt struct {
		Reason DisputeReason
		Count  int
	}
	var reasonCounts []reasonCnt
	r.db.Primary.WithContext(ctx).Table("fare_disputes").
		Select("reason, COUNT(*) as count").
		Where("created_at >= ? AND created_at < ?", from, to).
		Group("reason").
		Order("count DESC").
		Scan(&reasonCounts)

	stats.ByReason = make([]ReasonCount, 0, len(reasonCounts))
	for _, rc := range reasonCounts {
		percentage := 0.0
		if stats.TotalDisputes > 0 {
			percentage = float64(rc.Count) / float64(stats.TotalDisputes) * 100
		}
		stats.ByReason = append(stats.ByReason, ReasonCount{
			Reason:     rc.Reason,
			Count:      rc.Count,
			Percentage: percentage,
		})
	}

	return stats, nil
}
