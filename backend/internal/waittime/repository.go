package waittime

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

func (r *Repository) GetActiveConfig(ctx context.Context) (*WaitTimeConfig, error) {
	var c WaitTimeConfig
	err := r.db.Primary.WithContext(ctx).Where("is_active = ?", true).
		Order("created_at DESC").
		First(&c).Error
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (r *Repository) GetAllConfigs(ctx context.Context) ([]WaitTimeConfig, error) {
	var configs []WaitTimeConfig
	err := r.db.Primary.WithContext(ctx).Order("created_at DESC").Find(&configs).Error
	return configs, err
}

func (r *Repository) CreateConfig(ctx context.Context, c *WaitTimeConfig) error {
	return r.db.Primary.WithContext(ctx).Create(c).Error
}

func (r *Repository) CreateRecord(ctx context.Context, rec *WaitTimeRecord) error {
	return r.db.Primary.WithContext(ctx).Create(rec).Error
}

func (r *Repository) GetActiveWaitByRide(ctx context.Context, rideID uuid.UUID) (*WaitTimeRecord, error) {
	var rec WaitTimeRecord
	err := r.db.Primary.WithContext(ctx).Where("ride_id = ? AND status = ?", rideID, "waiting").
		Order("created_at DESC").
		First(&rec).Error
	if err != nil {
		return nil, err
	}
	return &rec, nil
}

func (r *Repository) CompleteWait(ctx context.Context, recordID uuid.UUID, totalWaitMin, chargeableMin, totalCharge float64, wasCapped bool) error {
	return r.db.Primary.WithContext(ctx).Model(&WaitTimeRecord{}).
		Where("id = ? AND status = ?", recordID, "waiting").
		Updates(map[string]interface{}{
			"status":             "completed",
			"started_at":         time.Now(),
			"total_wait_minutes": totalWaitMin,
			"chargeable_minutes": chargeableMin,
			"total_charge":       totalCharge,
			"was_capped":         wasCapped,
			"updated_at":         time.Now(),
		}).Error
}

func (r *Repository) WaiveCharge(ctx context.Context, recordID uuid.UUID) error {
	return r.db.Primary.WithContext(ctx).Model(&WaitTimeRecord{}).Where("id = ?", recordID).
		Updates(map[string]interface{}{
			"status":       "waived",
			"total_charge": 0,
			"updated_at":   time.Now(),
		}).Error
}

func (r *Repository) GetRecordsByRide(ctx context.Context, rideID uuid.UUID) ([]WaitTimeRecord, error) {
	var records []WaitTimeRecord
	err := r.db.Primary.WithContext(ctx).Where("ride_id = ?", rideID).
		Order("created_at ASC").
		Find(&records).Error
	return records, err
}

func (r *Repository) SaveNotification(ctx context.Context, n *WaitTimeNotification) error {
	return r.db.Primary.WithContext(ctx).Create(n).Error
}
