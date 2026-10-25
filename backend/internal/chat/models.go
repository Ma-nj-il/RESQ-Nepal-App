package chat

import (
	"time"

	"github.com/google/uuid"
)

type MessageType string

const (
	MessageTypeText     MessageType = "text"
	MessageTypeImage    MessageType = "image"
	MessageTypeLocation MessageType = "location"
	MessageTypeSystem   MessageType = "system"
)

type MessageStatus string

const (
	MessageStatusSent      MessageStatus = "sent"
	MessageStatusDelivered MessageStatus = "delivered"
	MessageStatusRead      MessageStatus = "read"
)

type ChatMessage struct {
	ID          uuid.UUID     `json:"id" gorm:"type:uuid;primaryKey"`
	RideID      uuid.UUID     `json:"ride_id" gorm:"type:uuid;index;not null"`
	SenderID    uuid.UUID     `json:"sender_id" gorm:"type:uuid;index;not null"`
	SenderRole  string        `json:"sender_role" gorm:"type:varchar(20);not null"`
	MessageType MessageType   `json:"message_type" gorm:"type:varchar(20);not null"`
	Content     string        `json:"content" gorm:"type:text;not null"`
	ImageURL    *string       `json:"image_url,omitempty" gorm:"type:text"`
	Latitude    *float64      `json:"latitude,omitempty"`
	Longitude   *float64      `json:"longitude,omitempty"`
	Status      MessageStatus `json:"status" gorm:"type:varchar(20);not null;default:'sent'"`
	DeliveredAt *time.Time    `json:"delivered_at,omitempty"`
	ReadAt      *time.Time    `json:"read_at,omitempty"`
	CreatedAt   time.Time     `json:"created_at" gorm:"not null"`
}

type QuickReply struct {
	ID        uuid.UUID `json:"id" gorm:"type:uuid;primaryKey"`
	Role      string    `json:"role" gorm:"type:varchar(20);not null"`
	Category  string    `json:"category" gorm:"type:varchar(50);not null"`
	Text      string    `json:"text" gorm:"type:text;not null"`
	SortOrder int       `json:"sort_order" gorm:"not null;default:0"`
	IsActive  bool      `json:"is_active" gorm:"not null;default:true"`
}

type SendMessageRequest struct {
	RideID      uuid.UUID   `json:"ride_id" binding:"required"`
	MessageType MessageType `json:"message_type" binding:"required"`
	Content     string      `json:"content" binding:"required"`
	ImageURL    *string     `json:"image_url,omitempty"`
	Latitude    *float64    `json:"latitude,omitempty"`
	Longitude   *float64    `json:"longitude,omitempty"`
}

type MarkReadRequest struct {
	RideID     uuid.UUID `json:"ride_id" binding:"required"`
	LastReadID uuid.UUID `json:"last_read_id" binding:"required"`
}

type ChatConversation struct {
	RideID       uuid.UUID     `json:"ride_id"`
	Messages     []ChatMessage `json:"messages"`
	UnreadCount  int           `json:"unread_count"`
	LastMessage  *ChatMessage  `json:"last_message,omitempty"`
	Participants []Participant `json:"participants"`
}

type Participant struct {
	UserID   uuid.UUID `json:"user_id"`
	Role     string    `json:"role"`
	Name     string    `json:"name"`
	IsOnline bool      `json:"is_online"`
}

type TranslationRequest struct {
	MessageID    uuid.UUID `json:"message_id" binding:"required"`
	TargetLocale string    `json:"target_locale" binding:"required"`
}
