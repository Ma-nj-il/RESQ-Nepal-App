package onboarding

import (
	"context"
	"database/sql"
	"time"

	"gorm.io/gorm"

	"github.com/google/uuid"
)

type Repository struct {
	db *gorm.DB
}

func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

type DriverInfo struct {
	ID            uuid.UUID  `json:"id"`
	UserID        uuid.UUID  `json:"user_id"`
	FirstName     string     `json:"first_name"`
	LastName      string     `json:"last_name"`
	PhoneNumber   string     `json:"phone_number"`
	Email         string     `json:"email"`
	LicenseNumber *string    `json:"license_number,omitempty"`
	VehicleID     *uuid.UUID `json:"vehicle_id,omitempty"`
	IsApproved    bool       `json:"is_approved"`
	IsSuspended   bool       `json:"is_suspended"`
	ApprovedAt    *time.Time `json:"approved_at,omitempty"`
	CreatedAt     *time.Time `json:"created_at,omitempty"`
	UpdatedAt     *time.Time `json:"updated_at,omitempty"`
}

type BackgroundCheck struct {
	ID          uuid.UUID  `json:"id"`
	DriverID    uuid.UUID  `json:"driver_id"`
	Status      string     `json:"status"`
	Provider    string     `json:"provider,omitempty"`
	ReportURL   *string    `json:"report_url,omitempty"`
	Notes       *string    `json:"notes,omitempty"`
	StartedAt   *time.Time `json:"started_at,omitempty"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
}

func (r *Repository) GetDriver(ctx context.Context, driverID uuid.UUID) (*DriverInfo, error) {
	query := `
		SELECT d.id, d.user_id, u.first_name, u.last_name, u.phone_number, u.email,
			   d.license_number, d.current_vehicle_id, d.is_approved,
			   COALESCE(u.is_active = false, false) as is_suspended,
			   d.approved_at, d.created_at, d.updated_at
		FROM drivers d
		JOIN users u ON d.user_id = u.id
		WHERE d.id = $1
	`

	driver := &DriverInfo{}
	err := r.sqlDB().QueryRowContext(ctx, query, driverID).Scan(
		&driver.ID, &driver.UserID, &driver.FirstName, &driver.LastName,
		&driver.PhoneNumber, &driver.Email, &driver.LicenseNumber,
		&driver.VehicleID, &driver.IsApproved, &driver.IsSuspended,
		&driver.ApprovedAt, &driver.CreatedAt, &driver.UpdatedAt,
	)

	if err != nil {
		return nil, err
	}

	return driver, nil
}

func (r *Repository) GetDriverByUserID(ctx context.Context, userID uuid.UUID) (*DriverInfo, error) {
	query := `
		SELECT d.id, d.user_id, u.first_name, u.last_name, u.phone_number, u.email,
			   d.license_number, d.current_vehicle_id, d.is_approved,
			   COALESCE(u.is_active = false, false) as is_suspended,
			   d.approved_at, d.created_at, d.updated_at
		FROM drivers d
		JOIN users u ON d.user_id = u.id
		WHERE d.user_id = $1
	`

	driver := &DriverInfo{}
	err := r.sqlDB().QueryRowContext(ctx, query, userID).Scan(
		&driver.ID, &driver.UserID, &driver.FirstName, &driver.LastName,
		&driver.PhoneNumber, &driver.Email, &driver.LicenseNumber,
		&driver.VehicleID, &driver.IsApproved, &driver.IsSuspended,
		&driver.ApprovedAt, &driver.CreatedAt, &driver.UpdatedAt,
	)

	if err != nil {
		return nil, err
	}

	return driver, nil
}

// CreateDriver creates a new driver record
func (r *Repository) CreateDriver(ctx context.Context, userID uuid.UUID) (uuid.UUID, error) {
	driverID := uuid.New()

	query := `
		INSERT INTO drivers (id, user_id, is_online, is_approved, created_at, updated_at)
		VALUES ($1, $2, false, false, NOW(), NOW())
		ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
		RETURNING id
	`

	var returnedID uuid.UUID
	err := r.sqlDB().QueryRowContext(ctx, query, driverID, userID).Scan(&returnedID)
	if err != nil {
		return uuid.Nil, err
	}

	return returnedID, nil
}

func (r *Repository) GetBackgroundCheck(ctx context.Context, driverID uuid.UUID) (*BackgroundCheck, error) {
	query := `
		SELECT id, driver_id, status, provider, report_url, notes, started_at, completed_at, created_at
		FROM driver_background_checks
		WHERE driver_id = $1
		ORDER BY created_at DESC
		LIMIT 1
	`

	check := &BackgroundCheck{}
	err := r.sqlDB().QueryRowContext(ctx, query, driverID).Scan(
		&check.ID, &check.DriverID, &check.Status, &check.Provider,
		&check.ReportURL, &check.Notes, &check.StartedAt, &check.CompletedAt, &check.CreatedAt,
	)

	if err != nil {
		return nil, err
	}

	return check, nil
}

func (r *Repository) CreateBackgroundCheck(ctx context.Context, driverID uuid.UUID, provider string) (*BackgroundCheck, error) {
	check := &BackgroundCheck{
		ID:        uuid.New(),
		DriverID:  driverID,
		Status:    "pending",
		Provider:  provider,
		CreatedAt: time.Now(),
	}

	query := `
		INSERT INTO driver_background_checks (id, driver_id, status, provider, created_at)
		VALUES ($1, $2, $3, $4, $5)
	`

	_, err := r.sqlDB().ExecContext(ctx, query, check.ID, check.DriverID, check.Status, check.Provider, check.CreatedAt)
	if err != nil {
		return nil, err
	}

	return check, nil
}

func (r *Repository) UpdateBackgroundCheckStatus(ctx context.Context, checkID uuid.UUID, status string, notes *string) error {
	query := `
		UPDATE driver_background_checks
		SET status = $1, notes = $2,
		    started_at = CASE WHEN $1 = 'in_progress' AND started_at IS NULL THEN NOW() ELSE started_at END,
		    completed_at = CASE WHEN $1 IN ('passed', 'failed') THEN NOW() ELSE completed_at END,
		    updated_at = NOW()
		WHERE id = $3
	`

	_, err := r.sqlDB().ExecContext(ctx, query, status, notes, checkID)
	return err
}

func (r *Repository) ApproveDriver(ctx context.Context, driverID uuid.UUID, approvedBy uuid.UUID) error {
	query := `
		UPDATE drivers
		SET is_approved = true, approved_at = NOW(), approved_by = $1, updated_at = NOW()
		WHERE id = $2
	`

	_, err := r.sqlDB().ExecContext(ctx, query, approvedBy, driverID)
	return err
}

func (r *Repository) RejectDriver(ctx context.Context, driverID uuid.UUID, rejectedBy uuid.UUID, reason string) error {
	query := `
		UPDATE drivers
		SET is_approved = false, rejection_reason = $1, rejected_at = NOW(), rejected_by = $2, updated_at = NOW()
		WHERE id = $3
	`

	_, err := r.sqlDB().ExecContext(ctx, query, reason, rejectedBy, driverID)
	return err
}

func (r *Repository) GetOnboardingStats(ctx context.Context) (*OnboardingStats, error) {
	query := `
		SELECT
			COUNT(*) FILTER (WHERE is_approved = false AND rejected_at IS NULL) as pending_count,
			COUNT(*) FILTER (WHERE is_approved = true) as approved_count,
			COUNT(*) FILTER (WHERE rejected_at IS NOT NULL) as rejected_count,
			COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as new_this_week,
			AVG(EXTRACT(EPOCH FROM (approved_at - created_at))/3600) FILTER (WHERE approved_at IS NOT NULL) as avg_approval_hours
		FROM drivers
	`

	stats := &OnboardingStats{}
	err := r.sqlDB().QueryRowContext(ctx, query).Scan(
		&stats.PendingCount, &stats.ApprovedCount, &stats.RejectedCount,
		&stats.NewThisWeek, &stats.AvgApprovalHours,
	)

	if err != nil {
		return nil, err
	}

	return stats, nil
}

type OnboardingStats struct {
	PendingCount     int      `json:"pending_count"`
	ApprovedCount    int      `json:"approved_count"`
	RejectedCount    int      `json:"rejected_count"`
	NewThisWeek      int      `json:"new_this_week"`
	AvgApprovalHours *float64 `json:"avg_approval_hours,omitempty"`
}

func (r *Repository) sqlDB() *sql.DB {
	sqlDB, _ := r.db.DB()
	return sqlDB
}
