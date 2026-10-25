package chat

import (
	"context"

	"github.com/bikky-kc013/medi-ambulance/pkg/database"
	"github.com/google/uuid"
)

type Repository struct {
	db *database.DBPool
}

func NewRepository(db *database.DBPool) *Repository {
	return &Repository{db: db}
}

func (r *Repository) SaveMessage(ctx context.Context, msg *ChatMessage) error {
	return r.db.Primary.WithContext(ctx).Create(msg).Error
}

func (r *Repository) GetMessagesByRide(ctx context.Context, rideID uuid.UUID, limit, offset int) ([]ChatMessage, error) {
	var messages []ChatMessage
	err := r.db.Primary.WithContext(ctx).Where("ride_id = ?", rideID).
		Order("created_at ASC").
		Limit(limit).Offset(offset).
		Find(&messages).Error
	return messages, err
}

func (r *Repository) GetMessageByID(ctx context.Context, messageID uuid.UUID) (*ChatMessage, error) {
	var m ChatMessage
	err := r.db.Primary.WithContext(ctx).First(&m, messageID).Error
	if err != nil {
		return nil, err
	}
	return &m, nil
}

func (r *Repository) MarkMessagesDelivered(ctx context.Context, rideID, recipientID uuid.UUID) error {
	return r.db.Primary.WithContext(ctx).Model(&ChatMessage{}).
		Where("ride_id = ? AND sender_id != ? AND status = ?", rideID, recipientID, MessageStatusSent).
		Update("status", MessageStatusDelivered).
		Update("delivered_at", "NOW()").Error
}

func (r *Repository) MarkMessagesRead(ctx context.Context, rideID, recipientID, lastReadID uuid.UUID) error {
	return r.db.Primary.WithContext(ctx).Model(&ChatMessage{}).
		Where("ride_id = ? AND sender_id != ? AND status IN ? AND created_at <= (SELECT created_at FROM chat_messages WHERE id = ?)",
			rideID, recipientID, []MessageStatus{MessageStatusSent, MessageStatusDelivered}, lastReadID).
		Updates(map[string]interface{}{
			"status":  MessageStatusRead,
			"read_at": "NOW()",
		}).Error
}

func (r *Repository) GetUnreadCount(ctx context.Context, rideID, userID uuid.UUID) (int, error) {
	var count int64
	err := r.db.Primary.WithContext(ctx).Model(&ChatMessage{}).
		Where("ride_id = ? AND sender_id != ? AND status != ?", rideID, userID, MessageStatusRead).
		Count(&count).Error
	return int(count), err
}

func (r *Repository) GetLastMessage(ctx context.Context, rideID uuid.UUID) (*ChatMessage, error) {
	var m ChatMessage
	err := r.db.Primary.WithContext(ctx).Where("ride_id = ?", rideID).
		Order("created_at DESC").
		First(&m).Error
	if err != nil {
		return nil, err
	}
	return &m, nil
}

func (r *Repository) DeleteMessagesByRide(ctx context.Context, rideID uuid.UUID) error {
	return r.db.Primary.WithContext(ctx).Where("ride_id = ?", rideID).Delete(&ChatMessage{}).Error
}

func (r *Repository) GetMessageCount(ctx context.Context, rideID uuid.UUID) (int, error) {
	var count int64
	err := r.db.Primary.WithContext(ctx).Model(&ChatMessage{}).Where("ride_id = ?", rideID).Count(&count).Error
	return int(count), err
}

func (r *Repository) GetQuickReplies(ctx context.Context, role string) ([]QuickReply, error) {
	var replies []QuickReply
	err := r.db.Primary.WithContext(ctx).Where("(role = ? OR role = ?) AND is_active = ?", role, "both", true).
		Order("category, sort_order").
		Find(&replies).Error
	return replies, err
}

func (r *Repository) CreateQuickReply(ctx context.Context, qr *QuickReply) error {
	return r.db.Primary.WithContext(ctx).Create(qr).Error
}

func (r *Repository) GetActiveConversations(ctx context.Context, userID uuid.UUID) ([]uuid.UUID, error) {
	var rideIDs []uuid.UUID
	err := r.db.Primary.WithContext(ctx).Model(&ChatMessage{}).
		Distinct("chat_messages.ride_id").
		Joins("JOIN rides r ON r.id = chat_messages.ride_id").
		Where("(r.rider_id = ? OR r.driver_id = ?) AND r.status IN ?",
			userID, userID, []string{"accepted", "in_progress"}).
		Order("chat_messages.ride_id").
		Pluck("chat_messages.ride_id", &rideIDs).Error
	return rideIDs, err
}
