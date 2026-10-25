package chat

import (
	"context"
	"fmt"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/common"
	ws "github.com/bikky-kc013/medi-ambulance/pkg/websocket"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

const (
	maxTextLength  = 1000
	maxImageURLLen = 2048
)

type Service struct {
	repo RepositoryInterface
	hub  HubInterface
}

func NewService(repo RepositoryInterface, hub HubInterface) *Service {
	return &Service{repo: repo, hub: hub}
}

func (s *Service) SendMessage(ctx context.Context, senderID uuid.UUID, senderRole string, req *SendMessageRequest) (*ChatMessage, error) {
	if !isValidMessageType(req.MessageType) {
		return nil, common.NewBadRequestError("invalid message type", nil)
	}

	if len(req.Content) == 0 {
		return nil, common.NewBadRequestError("message content cannot be empty", nil)
	}
	if len(req.Content) > maxTextLength {
		return nil, common.NewBadRequestError(
			fmt.Sprintf("message too long (max %d characters)", maxTextLength), nil)
	}

	if req.ImageURL != nil && len(*req.ImageURL) > maxImageURLLen {
		return nil, common.NewBadRequestError("image URL too long", nil)
	}

	if req.MessageType == MessageTypeLocation {
		if req.Latitude == nil || req.Longitude == nil {
			return nil, common.NewBadRequestError("location messages require latitude and longitude", nil)
		}
	}

	now := time.Now()
	msg := &ChatMessage{
		ID:          uuid.New(),
		RideID:      req.RideID,
		SenderID:    senderID,
		SenderRole:  senderRole,
		MessageType: req.MessageType,
		Content:     req.Content,
		ImageURL:    req.ImageURL,
		Latitude:    req.Latitude,
		Longitude:   req.Longitude,
		Status:      MessageStatusSent,
		CreatedAt:   now,
	}

	if err := s.repo.SaveMessage(ctx, msg); err != nil {
		return nil, fmt.Errorf("save message: %w", err)
	}

	if s.hub != nil {
		wsMsg := &ws.Message{
			Type:      "chat.message",
			RideID:    req.RideID.String(),
			UserID:    senderID.String(),
			Timestamp: now,
			Data: map[string]interface{}{
				"message_id":   msg.ID.String(),
				"sender_id":    senderID.String(),
				"sender_role":  senderRole,
				"message_type": string(msg.MessageType),
				"content":      msg.Content,
				"image_url":    msg.ImageURL,
				"latitude":     msg.Latitude,
				"longitude":    msg.Longitude,
			},
		}
		s.hub.SendToRide(req.RideID.String(), wsMsg)
	}

	return msg, nil
}

func (s *Service) SendSystemMessage(ctx context.Context, rideID uuid.UUID, content string) error {
	msg := &ChatMessage{
		ID:          uuid.New(),
		RideID:      rideID,
		SenderID:    uuid.Nil,
		SenderRole:  "system",
		MessageType: MessageTypeSystem,
		Content:     content,
		Status:      MessageStatusSent,
		CreatedAt:   time.Now(),
	}

	if err := s.repo.SaveMessage(ctx, msg); err != nil {
		return err
	}

	if s.hub != nil {
		wsMsg := &ws.Message{
			Type:      "chat.system",
			RideID:    rideID.String(),
			Timestamp: msg.CreatedAt,
			Data: map[string]interface{}{
				"message_id":   msg.ID.String(),
				"message_type": "system",
				"content":      content,
			},
		}
		s.hub.SendToRide(rideID.String(), wsMsg)
	}

	return nil
}

func (s *Service) GetConversation(ctx context.Context, userID, rideID uuid.UUID, limit, offset int) (*ChatConversation, error) {
	messages, err := s.repo.GetMessagesByRide(ctx, rideID, limit, offset)
	if err != nil {
		return nil, err
	}
	if messages == nil {
		messages = []ChatMessage{}
	}

	unreadCount, _ := s.repo.GetUnreadCount(ctx, rideID, userID)
	lastMsg, _ := s.repo.GetLastMessage(ctx, rideID)

	s.repo.MarkMessagesDelivered(ctx, rideID, userID)

	if s.hub != nil && len(messages) > 0 {
		wsMsg := &ws.Message{
			Type:      "chat.delivered",
			RideID:    rideID.String(),
			UserID:    userID.String(),
			Timestamp: time.Now(),
			Data: map[string]interface{}{
				"ride_id":      rideID.String(),
				"delivered_to": userID.String(),
			},
		}
		s.hub.SendToRide(rideID.String(), wsMsg)
	}

	return &ChatConversation{
		RideID:      rideID,
		Messages:    messages,
		UnreadCount: unreadCount,
		LastMessage: lastMsg,
	}, nil
}

func (s *Service) MarkAsRead(ctx context.Context, userID uuid.UUID, req *MarkReadRequest) error {
	if err := s.repo.MarkMessagesRead(ctx, req.RideID, userID, req.LastReadID); err != nil {
		return err
	}

	if s.hub != nil {
		wsMsg := &ws.Message{
			Type:      "chat.read",
			RideID:    req.RideID.String(),
			UserID:    userID.String(),
			Timestamp: time.Now(),
			Data: map[string]interface{}{
				"ride_id":      req.RideID.String(),
				"read_by":      userID.String(),
				"last_read_id": req.LastReadID.String(),
			},
		}
		s.hub.SendToRide(req.RideID.String(), wsMsg)
	}

	return nil
}

func (s *Service) GetQuickReplies(ctx context.Context, role string) ([]QuickReply, error) {
	replies, err := s.repo.GetQuickReplies(ctx, role)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return []QuickReply{}, nil
		}
		return nil, err
	}
	if replies == nil {
		replies = []QuickReply{}
	}
	return replies, nil
}

func (s *Service) GetActiveConversations(ctx context.Context, userID uuid.UUID) ([]uuid.UUID, error) {
	return s.repo.GetActiveConversations(ctx, userID)
}

func (s *Service) CleanupOldMessages(ctx context.Context, rideID uuid.UUID) error {
	return s.repo.DeleteMessagesByRide(ctx, rideID)
}

func isValidMessageType(mt MessageType) bool {
	switch mt {
	case MessageTypeText, MessageTypeImage, MessageTypeLocation:
		return true
	}
	return false
}
