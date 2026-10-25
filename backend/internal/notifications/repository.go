package notifications

import (
	"context"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/common"
	"github.com/bikky-kc013/medi-ambulance/pkg/database"
	"github.com/bikky-kc013/medi-ambulance/pkg/models"
	"github.com/google/uuid"
)

type Repository struct {
	db *database.DBPool
}

func NewRepository(db *database.DBPool) *Repository {
	return &Repository{db: db}
}

// CreateNotification creates a new notification record
func (r *Repository) CreateNotification(ctx context.Context, notification *models.Notification) error {
	err := r.db.Primary.WithContext(ctx).Create(notification).Error
	if err != nil {
		return common.NewInternalError("failed to create notification", err)
	}
	return nil
}

// GetNotificationByID retrieves a notification by ID
func (r *Repository) GetNotificationByID(ctx context.Context, id uuid.UUID) (*models.Notification, error) {
	notification := &models.Notification{}
	err := r.db.Primary.WithContext(ctx).First(notification, "id = ?", id).Error
	if err != nil {
		return nil, common.NewNotFoundError("notification not found", err)
	}
	return notification, nil
}

// UpdateNotificationStatus updates the notification status
func (r *Repository) UpdateNotificationStatus(ctx context.Context, id uuid.UUID, status string, errorMessage *string) error {
	updates := map[string]interface{}{
		"status":     status,
		"updated_at": time.Now(),
	}
	if status == "sent" {
		updates["sent_at"] = time.Now()
	}
	if errorMessage != nil {
		updates["error_message"] = *errorMessage
	}

	err := r.db.Primary.WithContext(ctx).Model(&models.Notification{}).Where("id = ?", id).Updates(updates).Error
	if err != nil {
		return common.NewInternalError("failed to update notification status", err)
	}
	return nil
}

// MarkNotificationAsRead marks a notification as read
func (r *Repository) MarkNotificationAsRead(ctx context.Context, id uuid.UUID) error {
	err := r.db.Primary.WithContext(ctx).Model(&models.Notification{}).
		Where("id = ? AND read_at IS NULL", id).
		Updates(map[string]interface{}{
			"read_at":    time.Now(),
			"is_read":    true,
			"updated_at": time.Now(),
		}).Error
	if err != nil {
		return common.NewInternalError("failed to mark notification as read", err)
	}
	return nil
}

// GetUserNotifications retrieves notifications for a user
func (r *Repository) GetUserNotifications(ctx context.Context, userID uuid.UUID, limit, offset int) ([]*models.Notification, error) {
	var notifications []*models.Notification
	err := r.db.Primary.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("created_at DESC").
		Limit(limit).
		Offset(offset).
		Find(&notifications).Error

	if err != nil {
		return nil, common.NewInternalError("failed to get notifications", err)
	}
	return notifications, nil
}

// GetUserNotificationsWithTotal retrieves notifications for a user with total count
func (r *Repository) GetUserNotificationsWithTotal(ctx context.Context, userID uuid.UUID, limit, offset int) ([]*models.Notification, int64, error) {
	var total int64
	err := r.db.Primary.WithContext(ctx).Model(&models.Notification{}).
		Where("user_id = ?", userID).
		Count(&total).Error
	if err != nil {
		return nil, 0, common.NewInternalError("failed to count notifications", err)
	}

	notifications, err := r.GetUserNotifications(ctx, userID, limit, offset)
	if err != nil {
		return nil, 0, err
	}

	return notifications, total, nil
}

// GetUnreadNotificationCount gets count of unread notifications
func (r *Repository) GetUnreadNotificationCount(ctx context.Context, userID uuid.UUID) (int, error) {
	var count int64
	err := r.db.Primary.WithContext(ctx).Model(&models.Notification{}).
		Where("user_id = ? AND read_at IS NULL AND status = 'sent'", userID).
		Count(&count).Error
	if err != nil {
		return 0, common.NewInternalError("failed to get unread count", err)
	}

	return int(count), nil
}

// GetPendingNotifications retrieves notifications that need to be sent
func (r *Repository) GetPendingNotifications(ctx context.Context, limit int) ([]*models.Notification, error) {
	var notifications []*models.Notification
	err := r.db.Primary.WithContext(ctx).
		Where("status IN ('pending','queued') AND (scheduled_at IS NULL OR scheduled_at <= NOW())").
		Order("created_at ASC").
		Limit(limit).
		Find(&notifications).Error

	if err != nil {
		return nil, common.NewInternalError("failed to get pending notifications", err)
	}
	return notifications, nil
}

// ScheduleNotificationRetry marks a notification for retry with a future scheduled time.
func (r *Repository) ScheduleNotificationRetry(ctx context.Context, id uuid.UUID, retryAt time.Time, errorMessage string) error {
	err := r.db.Primary.WithContext(ctx).Model(&models.Notification{}).
		Where("id = ?", id).
		Updates(map[string]interface{}{
			"status":        "queued",
			"scheduled_at":  retryAt,
			"error_message": errorMessage,
			"updated_at":    time.Now(),
		}).Error
	if err != nil {
		return common.NewInternalError("failed to schedule notification retry", err)
	}
	return nil
}

// GetUserDeviceTokens retrieves FCM device tokens for a user
func (r *Repository) GetUserDeviceTokens(ctx context.Context, userID uuid.UUID) ([]string, error) {
	// This would typically come from a device_tokens table
	// For now, we'll return an empty slice and implement this later
	// when we add a proper device registration system
	return []string{}, nil
}

// GetUserPhoneNumber retrieves user's phone number for SMS
func (r *Repository) GetUserPhoneNumber(ctx context.Context, userID uuid.UUID) (string, error) {
	var phoneNumber string
	err := r.db.Primary.WithContext(ctx).Table("users").Select("phone_number").Where("id = ?", userID).Scan(&phoneNumber).Error
	if err != nil {
		return "", common.NewNotFoundError("user not found", err)
	}
	return phoneNumber, nil
}

// GetUserEmail retrieves user's email for email notifications
func (r *Repository) GetUserEmail(ctx context.Context, userID uuid.UUID) (string, error) {
	var email string
	err := r.db.Primary.WithContext(ctx).Table("users").Select("email").Where("id = ?", userID).Scan(&email).Error
	if err != nil {
		return "", common.NewNotFoundError("user not found", err)
	}
	return email, nil
}
