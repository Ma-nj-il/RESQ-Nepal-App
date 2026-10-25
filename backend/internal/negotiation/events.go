package negotiation

import (
	"context"
	"encoding/json"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	"github.com/bikky-kc013/medi-ambulance/pkg/websocket"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

func toMap(v interface{}) map[string]interface{} {
	data, _ := json.Marshal(v)
	var result map[string]interface{}
	json.Unmarshal(data, &result)
	return result
}

type EventType string

const (
	EventSessionCreated   EventType = "negotiation.session_created"
	EventSessionUpdated   EventType = "negotiation.session_updated"
	EventSessionExpired   EventType = "negotiation.session_expired"
	EventSessionCancelled EventType = "negotiation.session_cancelled"
	EventSessionCompleted EventType = "negotiation.session_completed"

	EventOfferReceived  EventType = "negotiation.offer_received"
	EventOfferAccepted  EventType = "negotiation.offer_accepted"
	EventOfferRejected  EventType = "negotiation.offer_rejected"
	EventOfferWithdrawn EventType = "negotiation.offer_withdrawn"
	EventCounterOffer   EventType = "negotiation.counter_offer"
	EventOfferExpired   EventType = "negotiation.offer_expired"

	EventDriverInvited EventType = "negotiation.driver_invited"
	EventDriverJoined  EventType = "negotiation.driver_joined"
	EventDriverLeft    EventType = "negotiation.driver_left"

	EventFairPriceUpdated EventType = "negotiation.fair_price_updated"
	EventTimeWarning      EventType = "negotiation.time_warning"
)

type EventEmitter struct {
	hub *websocket.Hub
}

func NewEventEmitter(hub *websocket.Hub) *EventEmitter {
	return &EventEmitter{hub: hub}
}

type SessionCreatedEvent struct {
	SessionID         uuid.UUID `json:"session_id"`
	RiderID           uuid.UUID `json:"rider_id"`
	PickupLocation    Location  `json:"pickup_location"`
	DropoffLocation   Location  `json:"dropoff_location"`
	SystemEstimate    float64   `json:"system_estimate"`
	FairPriceMin      float64   `json:"fair_price_min"`
	FairPriceMax      float64   `json:"fair_price_max"`
	ProposedPrice     *float64  `json:"proposed_price,omitempty"`
	ExpiresAt         time.Time `json:"expires_at"`
	VehicleType       string    `json:"vehicle_type,omitempty"`
	EstimatedDistance float64   `json:"estimated_distance_km"`
	EstimatedDuration int       `json:"estimated_duration_min"`
	CreatedAt         time.Time `json:"created_at"`
}

type Location struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Address   string  `json:"address,omitempty"`
}

func (e *EventEmitter) EmitSessionCreated(ctx context.Context, event *SessionCreatedEvent, driverIDs []string) {
	msg := &websocket.Message{
		Type: string(EventSessionCreated),
		Data: toMap(event),
	}

	e.hub.SendToMultipleUsers(driverIDs, msg)

	for _, driverID := range driverIDs {
		e.hub.AddClientToNegotiation(driverID, event.SessionID.String())
	}

	e.hub.AddClientToNegotiation(event.RiderID.String(), event.SessionID.String())

	logger.Info("Session created event emitted",
		zap.String("session_id", event.SessionID.String()),
		zap.Int("driver_count", len(driverIDs)),
	)
}

type SessionCompletedEvent struct {
	SessionID       uuid.UUID  `json:"session_id"`
	AcceptedOfferID uuid.UUID  `json:"accepted_offer_id"`
	DriverID        uuid.UUID  `json:"driver_id"`
	RiderID         uuid.UUID  `json:"rider_id"`
	FinalPrice      float64    `json:"final_price"`
	RideID          *uuid.UUID `json:"ride_id,omitempty"`
	CompletedAt     time.Time  `json:"completed_at"`
}

func (e *EventEmitter) EmitSessionCompleted(ctx context.Context, event *SessionCompletedEvent) {
	msg := &websocket.Message{
		Type: string(EventSessionCompleted),
		Data: toMap(event),
	}

	e.hub.SendToNegotiation(event.SessionID.String(), msg)

	e.hub.CloseNegotiation(event.SessionID.String(), "session_completed")

	logger.Info("Session completed event emitted",
		zap.String("session_id", event.SessionID.String()),
		zap.String("driver_id", event.DriverID.String()),
		zap.Float64("final_price", event.FinalPrice),
	)
}

type SessionCancelledEvent struct {
	SessionID   uuid.UUID `json:"session_id"`
	CancelledBy string    `json:"cancelled_by"`
	Reason      string    `json:"reason"`
	CancelledAt time.Time `json:"cancelled_at"`
}

func (e *EventEmitter) EmitSessionCancelled(ctx context.Context, event *SessionCancelledEvent) {
	msg := &websocket.Message{
		Type: string(EventSessionCancelled),
		Data: toMap(event),
	}

	e.hub.SendToNegotiation(event.SessionID.String(), msg)
	e.hub.CloseNegotiation(event.SessionID.String(), event.Reason)

	logger.Info("Session cancelled event emitted",
		zap.String("session_id", event.SessionID.String()),
		zap.String("reason", event.Reason),
	)
}

type SessionExpiredEvent struct {
	SessionID   uuid.UUID `json:"session_id"`
	ExpiredAt   time.Time `json:"expired_at"`
	TotalOffers int       `json:"total_offers"`
}

func (e *EventEmitter) EmitSessionExpired(ctx context.Context, event *SessionExpiredEvent) {
	msg := &websocket.Message{
		Type: string(EventSessionExpired),
		Data: toMap(event),
	}

	e.hub.SendToNegotiation(event.SessionID.String(), msg)
	e.hub.CloseNegotiation(event.SessionID.String(), "session_expired")

	logger.Info("Session expired event emitted",
		zap.String("session_id", event.SessionID.String()),
	)
}

type OfferReceivedEvent struct {
	SessionID    uuid.UUID `json:"session_id"`
	OfferID      uuid.UUID `json:"offer_id"`
	DriverID     uuid.UUID `json:"driver_id"`
	DriverName   string    `json:"driver_name"`
	DriverRating float64   `json:"driver_rating"`
	DriverPhoto  string    `json:"driver_photo,omitempty"`
	VehicleInfo  string    `json:"vehicle_info,omitempty"`
	OfferedPrice float64   `json:"offered_price"`
	ETA          int       `json:"eta_minutes"`
	Message      string    `json:"message,omitempty"`
	OfferNumber  int       `json:"offer_number"`
	TotalOffers  int       `json:"total_offers"`
	CreatedAt    time.Time `json:"created_at"`
	ExpiresAt    time.Time `json:"expires_at"`
}

func (e *EventEmitter) EmitOfferReceived(ctx context.Context, event *OfferReceivedEvent) {
	msg := &websocket.Message{
		Type: string(EventOfferReceived),
		Data: toMap(event),
	}

	e.hub.SendToNegotiation(event.SessionID.String(), msg)

	logger.Info("Offer received event emitted",
		zap.String("session_id", event.SessionID.String()),
		zap.String("offer_id", event.OfferID.String()),
		zap.Float64("price", event.OfferedPrice),
	)
}

type OfferAcceptedEvent struct {
	SessionID     uuid.UUID `json:"session_id"`
	OfferID       uuid.UUID `json:"offer_id"`
	DriverID      uuid.UUID `json:"driver_id"`
	RiderID       uuid.UUID `json:"rider_id"`
	AcceptedPrice float64   `json:"accepted_price"`
	AcceptedAt    time.Time `json:"accepted_at"`
}

func (e *EventEmitter) EmitOfferAccepted(ctx context.Context, event *OfferAcceptedEvent) {
	msg := &websocket.Message{
		Type: string(EventOfferAccepted),
		Data: toMap(event),
	}

	e.hub.SendToNegotiation(event.SessionID.String(), msg)

	logger.Info("Offer accepted event emitted",
		zap.String("session_id", event.SessionID.String()),
		zap.String("offer_id", event.OfferID.String()),
	)
}

type OfferRejectedEvent struct {
	SessionID  uuid.UUID `json:"session_id"`
	OfferID    uuid.UUID `json:"offer_id"`
	DriverID   uuid.UUID `json:"driver_id"`
	Reason     string    `json:"reason,omitempty"`
	RejectedAt time.Time `json:"rejected_at"`
}

func (e *EventEmitter) EmitOfferRejected(ctx context.Context, event *OfferRejectedEvent) {
	msg := &websocket.Message{
		Type: string(EventOfferRejected),
		Data: toMap(event),
	}

	e.hub.SendToUser(event.DriverID.String(), msg)

	logger.Info("Offer rejected event emitted",
		zap.String("session_id", event.SessionID.String()),
		zap.String("offer_id", event.OfferID.String()),
	)
}

type CounterOfferEvent struct {
	SessionID       uuid.UUID `json:"session_id"`
	OriginalOfferID uuid.UUID `json:"original_offer_id"`
	DriverID        uuid.UUID `json:"driver_id"`
	CounterPrice    float64   `json:"counter_price"`
	Message         string    `json:"message,omitempty"`
	Round           int       `json:"round"`
	MaxRounds       int       `json:"max_rounds"`
	ExpiresAt       time.Time `json:"expires_at"`
	CreatedAt       time.Time `json:"created_at"`
}

func (e *EventEmitter) EmitCounterOffer(ctx context.Context, event *CounterOfferEvent) {
	msg := &websocket.Message{
		Type: string(EventCounterOffer),
		Data: toMap(event),
	}

	e.hub.SendToUser(event.DriverID.String(), msg)

	logger.Info("Counter offer event emitted",
		zap.String("session_id", event.SessionID.String()),
		zap.String("driver_id", event.DriverID.String()),
		zap.Float64("counter_price", event.CounterPrice),
	)
}

type OfferWithdrawnEvent struct {
	SessionID   uuid.UUID `json:"session_id"`
	OfferID     uuid.UUID `json:"offer_id"`
	DriverID    uuid.UUID `json:"driver_id"`
	Reason      string    `json:"reason,omitempty"`
	WithdrawnAt time.Time `json:"withdrawn_at"`
}

func (e *EventEmitter) EmitOfferWithdrawn(ctx context.Context, event *OfferWithdrawnEvent) {
	msg := &websocket.Message{
		Type: string(EventOfferWithdrawn),
		Data: toMap(event),
	}

	e.hub.SendToNegotiation(event.SessionID.String(), msg)

	logger.Info("Offer withdrawn event emitted",
		zap.String("session_id", event.SessionID.String()),
		zap.String("offer_id", event.OfferID.String()),
	)
}

type DriverInvitedEvent struct {
	SessionID        uuid.UUID `json:"session_id"`
	DriverID         uuid.UUID `json:"driver_id"`
	PickupLocation   Location  `json:"pickup_location"`
	DropoffLocation  Location  `json:"dropoff_location"`
	EstimatedPrice   float64   `json:"estimated_price"`
	FairPriceMin     float64   `json:"fair_price_min"`
	FairPriceMax     float64   `json:"fair_price_max"`
	DistanceToPickup float64   `json:"distance_to_pickup_km"`
	ETAToPickup      int       `json:"eta_to_pickup_min"`
	ExpiresAt        time.Time `json:"expires_at"`
}

func (e *EventEmitter) EmitDriverInvited(ctx context.Context, event *DriverInvitedEvent) {
	msg := &websocket.Message{
		Type: string(EventDriverInvited),
		Data: toMap(event),
	}

	e.hub.SendToUser(event.DriverID.String(), msg)
	e.hub.AddClientToNegotiation(event.DriverID.String(), event.SessionID.String())

	logger.Debug("Driver invited event emitted",
		zap.String("session_id", event.SessionID.String()),
		zap.String("driver_id", event.DriverID.String()),
	)
}

type DriverJoinedEvent struct {
	SessionID    uuid.UUID `json:"session_id"`
	DriverID     uuid.UUID `json:"driver_id"`
	DriverName   string    `json:"driver_name"`
	DriverRating float64   `json:"driver_rating"`
	TotalDrivers int       `json:"total_drivers"`
	JoinedAt     time.Time `json:"joined_at"`
}

func (e *EventEmitter) EmitDriverJoined(ctx context.Context, event *DriverJoinedEvent) {
	msg := &websocket.Message{
		Type: string(EventDriverJoined),
		Data: toMap(event),
	}

	e.hub.SendToNegotiation(event.SessionID.String(), msg)

	logger.Debug("Driver joined event emitted",
		zap.String("session_id", event.SessionID.String()),
		zap.String("driver_id", event.DriverID.String()),
	)
}

type DriverLeftEvent struct {
	SessionID    uuid.UUID `json:"session_id"`
	DriverID     uuid.UUID `json:"driver_id"`
	Reason       string    `json:"reason,omitempty"`
	TotalDrivers int       `json:"total_drivers"`
	LeftAt       time.Time `json:"left_at"`
}

func (e *EventEmitter) EmitDriverLeft(ctx context.Context, event *DriverLeftEvent) {
	msg := &websocket.Message{
		Type: string(EventDriverLeft),
		Data: toMap(event),
	}

	e.hub.SendToNegotiation(event.SessionID.String(), msg)
	e.hub.RemoveClientFromNegotiation(event.DriverID.String(), event.SessionID.String())

	logger.Debug("Driver left event emitted",
		zap.String("session_id", event.SessionID.String()),
		zap.String("driver_id", event.DriverID.String()),
	)
}

type TimeWarningEvent struct {
	SessionID        uuid.UUID `json:"session_id"`
	RemainingSeconds int       `json:"remaining_seconds"`
	WarningLevel     string    `json:"warning_level"`
}

func (e *EventEmitter) EmitTimeWarning(ctx context.Context, event *TimeWarningEvent) {
	msg := &websocket.Message{
		Type: string(EventTimeWarning),
		Data: toMap(event),
	}

	e.hub.SendToNegotiation(event.SessionID.String(), msg)

	logger.Debug("Time warning event emitted",
		zap.String("session_id", event.SessionID.String()),
		zap.Int("remaining_seconds", event.RemainingSeconds),
	)
}

type FairPriceUpdatedEvent struct {
	SessionID    uuid.UUID `json:"session_id"`
	FairPriceMin float64   `json:"fair_price_min"`
	FairPriceMax float64   `json:"fair_price_max"`
	Reason       string    `json:"reason"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (e *EventEmitter) EmitFairPriceUpdated(ctx context.Context, event *FairPriceUpdatedEvent) {
	msg := &websocket.Message{
		Type: string(EventFairPriceUpdated),
		Data: toMap(event),
	}

	e.hub.SendToNegotiation(event.SessionID.String(), msg)

	logger.Info("Fair price updated event emitted",
		zap.String("session_id", event.SessionID.String()),
		zap.Float64("min", event.FairPriceMin),
		zap.Float64("max", event.FairPriceMax),
	)
}

func (e *EventEmitter) AddRiderToSession(riderID, sessionID string) {
	e.hub.AddClientToNegotiation(riderID, sessionID)
}

func (e *EventEmitter) RemoveParticipant(userID, sessionID string) {
	e.hub.RemoveClientFromNegotiation(userID, sessionID)
}

func (e *EventEmitter) GetParticipantCount(sessionID string) int {
	return len(e.hub.GetClientsInNegotiation(sessionID))
}

func (e *EventEmitter) IsUserInSession(userID, sessionID string) bool {
	clients := e.hub.GetClientsInNegotiation(sessionID)
	for _, client := range clients {
		if client.ID == userID {
			return true
		}
	}
	return false
}
