package vehicle

import (
	"context"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/database"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Repository struct {
	db *database.DBPool
}

func NewRepository(db *database.DBPool) *Repository {
	return &Repository{db: db}
}

func (r *Repository) GetAllVehicles(ctx context.Context) ([]Vehicle, error) {
	var vehicles []Vehicle

	if err := r.db.Primary.
		WithContext(ctx).
		Order("created_at DESC").
		Find(&vehicles).Error; err != nil {
		return nil, err
	}

	return vehicles, nil
}
func (r *Repository) CreateVehicle(ctx context.Context, v *Vehicle) error {
	return r.db.Primary.WithContext(ctx).Create(v).Error
}

func (r *Repository) GetVehicleByID(ctx context.Context, id uuid.UUID) (*Vehicle, error) {
	var v Vehicle
	err := r.db.Primary.WithContext(ctx).First(&v, "id = ?", id).Error
	if err != nil {
		return nil, err
	}
	return &v, nil
}

func (r *Repository) GetVehiclesByDriver(ctx context.Context, driverID uuid.UUID) ([]Vehicle, error) {
	var vehicles []Vehicle
	err := r.db.Primary.WithContext(ctx).Where("driver_id = ?", driverID).
		Order("is_primary DESC, created_at DESC").
		Find(&vehicles).Error
	return vehicles, err
}

func (r *Repository) GetPrimaryVehicle(ctx context.Context, driverID uuid.UUID) (*Vehicle, error) {
	var v Vehicle
	err := r.db.Primary.WithContext(ctx).Where("driver_id = ? AND is_primary = ? AND is_active = ?", driverID, true, true).First(&v).Error
	if err != nil {
		return nil, err
	}
	return &v, nil
}

func (r *Repository) UpdateVehicle(ctx context.Context, v *Vehicle) error {
	return r.db.Primary.WithContext(ctx).Save(v).Error
}

func (r *Repository) UpdateVehiclePhotos(ctx context.Context, vehicleID uuid.UUID, photos *UploadVehiclePhotosRequest) error {
	updates := make(map[string]interface{})
	if photos.RegistrationPhotoURL != nil {
		updates["registration_photo_url"] = *photos.RegistrationPhotoURL
	}
	if photos.InsurancePhotoURL != nil {
		updates["insurance_photo_url"] = *photos.InsurancePhotoURL
	}
	if photos.FrontPhotoURL != nil {
		updates["front_photo_url"] = *photos.FrontPhotoURL
	}
	if photos.BackPhotoURL != nil {
		updates["back_photo_url"] = *photos.BackPhotoURL
	}
	if photos.SidePhotoURL != nil {
		updates["side_photo_url"] = *photos.SidePhotoURL
	}
	if photos.InteriorPhotoURL != nil {
		updates["interior_photo_url"] = *photos.InteriorPhotoURL
	}
	updates["updated_at"] = time.Now()

	return r.db.Primary.WithContext(ctx).Model(&Vehicle{}).Where("id = ?", vehicleID).Updates(updates).Error
}

func (r *Repository) UpdateVehicleStatus(ctx context.Context, vehicleID uuid.UUID, status VehicleStatus, reason *string) error {
	return r.db.Primary.WithContext(ctx).Model(&Vehicle{}).Where("id = ?", vehicleID).Updates(map[string]interface{}{
		"status":           status,
		"rejection_reason": reason,
		"updated_at":       time.Now(),
	}).Error
}

func (r *Repository) SetPrimaryVehicle(ctx context.Context, driverID, vehicleID uuid.UUID) error {
	return r.db.Primary.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&Vehicle{}).Where("driver_id = ?", driverID).Updates(map[string]interface{}{
			"is_primary": false,
			"updated_at": time.Now(),
		}).Error; err != nil {
			return err
		}

		return tx.Model(&Vehicle{}).Where("id = ? AND driver_id = ?", vehicleID, driverID).Updates(map[string]interface{}{
			"is_primary": true,
			"updated_at": time.Now(),
		}).Error
	})
}

func (r *Repository) RetireVehicle(ctx context.Context, vehicleID uuid.UUID) error {
	return r.db.Primary.WithContext(ctx).Model(&Vehicle{}).Where("id = ?", vehicleID).Updates(map[string]interface{}{
		"status":     VehicleStatusRetired,
		"is_active":  false,
		"is_primary": false,
		"updated_at": time.Now(),
	}).Error
}

func (r *Repository) GetPendingReviewVehicles(ctx context.Context, limit, offset int) ([]Vehicle, int, error) {
	var total int64
	query := r.db.Primary.WithContext(ctx).Model(&Vehicle{}).Where("status = ?", VehicleStatusPending)

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var vehicles []Vehicle
	err := query.Order("created_at ASC").Limit(limit).Offset(offset).Find(&vehicles).Error
	return vehicles, int(total), err
}

func (r *Repository) GetVehicleStats(ctx context.Context) (*VehicleStats, error) {
	stats := &VehicleStats{}
	err := r.db.Primary.WithContext(ctx).Model(&Vehicle{}).
		Where("is_active = ?", true).
		Select(`
			COUNT(*) as total_vehicles,
			COUNT(CASE WHEN status = ? THEN 1 END) as pending_review,
			COUNT(CASE WHEN status = ? THEN 1 END) as approved_vehicles,
			COUNT(CASE WHEN status = ? THEN 1 END) as suspended_vehicles,
			COUNT(CASE WHEN insurance_expiry IS NOT NULL AND insurance_expiry < ? THEN 1 END) as expiring_insurance,
			COUNT(CASE WHEN registration_expiry IS NOT NULL AND registration_expiry < ? THEN 1 END) as expiring_registration
		`, VehicleStatusPending, VehicleStatusApproved, VehicleStatusSuspended, time.Now().AddDate(0, 0, 30), time.Now().AddDate(0, 0, 30)).
		Scan(stats).Error
	return stats, err
}

func (r *Repository) GetExpiringVehicles(ctx context.Context, daysAhead int) ([]Vehicle, error) {
	threshold := time.Now().AddDate(0, 0, daysAhead)
	var vehicles []Vehicle
	err := r.db.Primary.WithContext(ctx).
		Where("is_active = ? AND status = ? AND (insurance_expiry < ? OR registration_expiry < ? OR inspection_expiry < ?)",
			true, VehicleStatusApproved, threshold, threshold, threshold).
		Order(`LEAST(
			COALESCE(insurance_expiry, '9999-12-31'),
			COALESCE(registration_expiry, '9999-12-31'),
			COALESCE(inspection_expiry, '9999-12-31')
		)`).
		Find(&vehicles).Error
	return vehicles, err
}

func (r *Repository) CreateInspection(ctx context.Context, insp *VehicleInspection) error {
	return r.db.Primary.WithContext(ctx).Create(insp).Error
}

func (r *Repository) GetInspectionsByVehicle(ctx context.Context, vehicleID uuid.UUID) ([]VehicleInspection, error) {
	var inspections []VehicleInspection
	err := r.db.Primary.WithContext(ctx).Where("vehicle_id = ?", vehicleID).
		Order("scheduled_at DESC").
		Find(&inspections).Error
	return inspections, err
}

func (r *Repository) CreateMaintenanceReminder(ctx context.Context, rem *MaintenanceReminder) error {
	return r.db.Primary.WithContext(ctx).Create(rem).Error
}

func (r *Repository) GetPendingReminders(ctx context.Context, vehicleID uuid.UUID) ([]MaintenanceReminder, error) {
	var reminders []MaintenanceReminder
	err := r.db.Primary.WithContext(ctx).Where("vehicle_id = ? AND is_completed = ?", vehicleID, false).
		Order("due_date ASC NULLS LAST").
		Find(&reminders).Error
	return reminders, err
}

func (r *Repository) CompleteReminder(ctx context.Context, reminderID uuid.UUID) error {
	return r.db.Primary.WithContext(ctx).Model(&MaintenanceReminder{}).Where("id = ?", reminderID).Updates(map[string]interface{}{
		"is_completed": true,
		"completed_at": time.Now(),
	}).Error
}
