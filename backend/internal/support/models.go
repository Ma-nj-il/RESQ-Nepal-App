package support

import (
	"time"

	"github.com/google/uuid"
)

// TicketStatus represents the status of a support ticket
type TicketStatus string

const (
	TicketStatusOpen       TicketStatus = "open"
	TicketStatusInProgress TicketStatus = "in_progress"
	TicketStatusWaiting    TicketStatus = "waiting_on_user"
	TicketStatusResolved   TicketStatus = "resolved"
	TicketStatusClosed     TicketStatus = "closed"
	TicketStatusEscalated  TicketStatus = "escalated"
)

// TicketPriority represents the priority of a support ticket
type TicketPriority string

const (
	PriorityLow    TicketPriority = "low"
	PriorityMedium TicketPriority = "medium"
	PriorityHigh   TicketPriority = "high"
	PriorityUrgent TicketPriority = "urgent"
)

// TicketCategory represents the category of a support ticket
type TicketCategory string

const (
	CategoryPayment     TicketCategory = "payment"
	CategoryRide        TicketCategory = "ride"
	CategoryDriver      TicketCategory = "driver"
	CategoryAccount     TicketCategory = "account"
	CategorySafety      TicketCategory = "safety"
	CategoryPromo       TicketCategory = "promo"
	CategoryApp         TicketCategory = "app_issue"
	CategoryFeedback    TicketCategory = "feedback"
	CategoryLostItem    TicketCategory = "lost_item"
	CategoryFareDispute TicketCategory = "fare_dispute"
	CategoryOther       TicketCategory = "other"
)

// MessageSender represents who sent the message
type MessageSender string

const (
	SenderUser   MessageSender = "user"
	SenderAgent  MessageSender = "agent"
	SenderSystem MessageSender = "system"
)

// Ticket represents a support ticket
type Ticket struct {
	ID           uuid.UUID      `json:"id" gorm:"type:uuid;primaryKey"`
	UserID       uuid.UUID      `json:"user_id" gorm:"type:uuid;index"`
	RideID       *uuid.UUID     `json:"ride_id,omitempty" gorm:"type:uuid;index"`
	AssignedTo   *uuid.UUID     `json:"assigned_to,omitempty" gorm:"type:uuid;index"`
	TicketNumber string         `json:"ticket_number" gorm:"uniqueIndex;not null"`
	Category     TicketCategory `json:"category" gorm:"not null"`
	Priority     TicketPriority `json:"priority" gorm:"not null"`
	Status       TicketStatus   `json:"status" gorm:"not null"`
	Subject      string         `json:"subject" gorm:"not null"`
	Description  string         `json:"description" gorm:"not null"`
	Tags         []string       `json:"tags,omitempty" gorm:"serializer:json"`
	ResolvedAt   *time.Time     `json:"resolved_at,omitempty"`
	ClosedAt     *time.Time     `json:"closed_at,omitempty"`
	CreatedAt    time.Time      `json:"created_at" gorm:"not null"`
	UpdatedAt    time.Time      `json:"updated_at" gorm:"not null"`
}

// TicketMessage represents a message in a support ticket thread
type TicketMessage struct {
	ID          uuid.UUID     `json:"id" gorm:"type:uuid;primaryKey"`
	TicketID    uuid.UUID     `json:"ticket_id" gorm:"type:uuid;index"`
	SenderID    uuid.UUID     `json:"sender_id" gorm:"type:uuid;index"`
	SenderType  MessageSender `json:"sender_type" gorm:"not null"`
	Message     string        `json:"message" gorm:"not null"`
	Attachments []string      `json:"attachments,omitempty" gorm:"serializer:json"`
	IsInternal  bool          `json:"is_internal" gorm:"not null;default:false"`
	CreatedAt   time.Time     `json:"created_at" gorm:"not null"`
}

// FAQArticle represents a help center article
type FAQArticle struct {
	ID        uuid.UUID `json:"id" gorm:"type:uuid;primaryKey"`
	Category  string    `json:"category" gorm:"not null;index"`
	Title     string    `json:"title" gorm:"not null"`
	Content   string    `json:"content" gorm:"not null"`
	SortOrder int       `json:"sort_order" gorm:"not null;default:0"`
	IsActive  bool      `json:"is_active" gorm:"not null;default:true"`
	ViewCount int       `json:"view_count" gorm:"not null;default:0"`
	CreatedAt time.Time `json:"created_at" gorm:"not null"`
	UpdatedAt time.Time `json:"updated_at" gorm:"not null"`
}

// TicketSummary is a lightweight view of a ticket for lists
type TicketSummary struct {
	ID           uuid.UUID      `json:"id"`
	TicketNumber string         `json:"ticket_number"`
	Category     TicketCategory `json:"category"`
	Priority     TicketPriority `json:"priority"`
	Status       TicketStatus   `json:"status"`
	Subject      string         `json:"subject"`
	LastMessage  *string        `json:"last_message,omitempty"`
	MessageCount int            `json:"message_count"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
}

// TicketStats represents admin ticket analytics
type TicketStats struct {
	TotalOpen        int            `json:"total_open"`
	TotalInProgress  int            `json:"total_in_progress"`
	TotalWaiting     int            `json:"total_waiting"`
	TotalResolved    int            `json:"total_resolved"`
	TotalEscalated   int            `json:"total_escalated"`
	AvgResolutionMin float64        `json:"avg_resolution_minutes"`
	ByCategory       map[string]int `json:"by_category"`
	ByPriority       map[string]int `json:"by_priority"`
}

// ========================================
// REQUEST/RESPONSE TYPES
// ========================================

// CreateTicketRequest represents a request to create a support ticket
type CreateTicketRequest struct {
	Category    TicketCategory  `json:"category" binding:"required"`
	Subject     string          `json:"subject" binding:"required,min=5,max=200"`
	Description string          `json:"description" binding:"required,min=10,max=5000"`
	RideID      *uuid.UUID      `json:"ride_id,omitempty"`
	Priority    *TicketPriority `json:"priority,omitempty"`
}

// AddMessageRequest adds a message to a ticket
type AddMessageRequest struct {
	Message     string   `json:"message" binding:"required,min=1,max=5000"`
	Attachments []string `json:"attachments,omitempty"`
}

// UpdateTicketRequest updates ticket status/assignment (admin)
type UpdateTicketRequest struct {
	Status     *TicketStatus   `json:"status,omitempty"`
	Priority   *TicketPriority `json:"priority,omitempty"`
	AssignedTo *uuid.UUID      `json:"assigned_to,omitempty"`
	Tags       []string        `json:"tags,omitempty"`
}

// AdminReplyRequest is an admin reply with optional internal note
type AdminReplyRequest struct {
	Message    string `json:"message" binding:"required,min=1,max=5000"`
	IsInternal bool   `json:"is_internal"`
}
