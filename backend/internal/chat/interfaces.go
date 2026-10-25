package chat

import (
	"context"

	ws "github.com/bikky-kc013/medi-ambulance/pkg/websocket"
	"github.com/google/uuid"
)

type RepositoryInterface interface {
	SaveMessage(ctx context.Context, msg *ChatMessage) error
	GetMessagesByRide(ctx context.Context, rideID uuid.UUID, limit, offset int) ([]ChatMessage, error)
	GetMessageByID(ctx context.Context, messageID uuid.UUID) (*ChatMessage, error)
	MarkMessagesDelivered(ctx context.Context, rideID, recipientID uuid.UUID) error
	MarkMessagesRead(ctx context.Context, rideID, recipientID, lastReadID uuid.UUID) error
	GetUnreadCount(ctx context.Context, rideID, userID uuid.UUID) (int, error)
	GetLastMessage(ctx context.Context, rideID uuid.UUID) (*ChatMessage, error)
	DeleteMessagesByRide(ctx context.Context, rideID uuid.UUID) error
	GetMessageCount(ctx context.Context, rideID uuid.UUID) (int, error)

	GetQuickReplies(ctx context.Context, role string) ([]QuickReply, error)
	CreateQuickReply(ctx context.Context, qr *QuickReply) error

	GetActiveConversations(ctx context.Context, userID uuid.UUID) ([]uuid.UUID, error)
}

type HubInterface interface {
	SendToRide(rideID string, msg *ws.Message)
	SendToUser(userID string, msg *ws.Message)
}
