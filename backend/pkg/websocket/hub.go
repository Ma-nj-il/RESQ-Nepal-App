package websocket

import (
	"sync"

	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	"go.uber.org/zap"
)

type MessageHandler func(*Client, *Message)

type Hub struct {
	clients map[string]*Client

	rides map[string]map[string]*Client

	negotiations map[string]map[string]*Client

	Register chan *Client

	Unregister chan *Client

	Broadcast chan *BroadcastMessage

	handlers map[string]MessageHandler

	mu sync.RWMutex
}

type BroadcastMessage struct {
	Target   string
	TargetID string
	Message  *Message
}

func NewHub() *Hub {
	return &Hub{
		clients:      make(map[string]*Client),
		rides:        make(map[string]map[string]*Client),
		negotiations: make(map[string]map[string]*Client),
		Register:     make(chan *Client),
		Unregister:   make(chan *Client),
		Broadcast:    make(chan *BroadcastMessage, 256),
		handlers:     make(map[string]MessageHandler),
	}
}

func (h *Hub) Run() {
	logger.Info("WebSocket Hub started")
	for {
		select {
		case client := <-h.Register:
			h.registerClient(client)

		case client := <-h.Unregister:
			h.unregisterClient(client)

		case broadcast := <-h.Broadcast:
			h.broadcastMessage(broadcast)
		}
	}
}

func (h *Hub) registerClient(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if existingClient, ok := h.clients[client.ID]; ok {
		existingClient.mu.Lock()
		existingClient.closed = true
		existingClient.mu.Unlock()
		existingClient.closeOnce.Do(func() {
			close(existingClient.Send)
		})
		logger.Info("Replaced existing client connection", zap.String("client_id", client.ID))
	}

	h.clients[client.ID] = client
	logger.Info("Client registered", zap.String("client_id", client.ID), zap.String("role", client.Role))
}

func (h *Hub) unregisterClient(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if _, ok := h.clients[client.ID]; ok {
		delete(h.clients, client.ID)

		rideID := client.GetRide()
		if rideID != "" {
			if ride, ok := h.rides[rideID]; ok {
				delete(ride, client.ID)
				if len(ride) == 0 {
					delete(h.rides, rideID)
				}
			}
		}

		client.mu.Lock()
		client.closed = true
		client.mu.Unlock()
		client.closeOnce.Do(func() {
			close(client.Send)
		})
		logger.Info("Client unregistered", zap.String("client_id", client.ID))
	}
}

func (h *Hub) broadcastMessage(broadcast *BroadcastMessage) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	switch broadcast.Target {
	case "user":
		if client, ok := h.clients[broadcast.TargetID]; ok {
			client.SendMessage(broadcast.Message)
		}

	case "ride":
		if ride, ok := h.rides[broadcast.TargetID]; ok {
			for _, client := range ride {
				client.SendMessage(broadcast.Message)
			}
		}

	case "negotiation":
		if negotiation, ok := h.negotiations[broadcast.TargetID]; ok {
			for _, client := range negotiation {
				client.SendMessage(broadcast.Message)
			}
		}

	case "all":
		for _, client := range h.clients {
			client.SendMessage(broadcast.Message)
		}
	}
}

func (h *Hub) HandleMessage(client *Client, msg *Message) {
	h.mu.RLock()
	handler, exists := h.handlers[msg.Type]
	h.mu.RUnlock()

	if exists {
		handler(client, msg)
	} else {
		logger.Warn("No handler for message type", zap.String("type", msg.Type))
	}
}

func (h *Hub) RegisterHandler(msgType string, handler MessageHandler) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.handlers[msgType] = handler
	logger.Info("Registered handler for message type", zap.String("type", msgType))
}

func (h *Hub) AddClientToRide(clientID, rideID string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	client, ok := h.clients[clientID]
	if !ok {
		return
	}

	if _, ok := h.rides[rideID]; !ok {
		h.rides[rideID] = make(map[string]*Client)
	}

	h.rides[rideID][clientID] = client
	client.SetRide(rideID)

	logger.Info("Client joined ride", zap.String("client_id", clientID), zap.String("ride_id", rideID))
}

func (h *Hub) RemoveClientFromRide(clientID, rideID string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if ride, ok := h.rides[rideID]; ok {
		delete(ride, clientID)
		if len(ride) == 0 {
			delete(h.rides, rideID)
		}
	}

	if client, ok := h.clients[clientID]; ok {
		client.SetRide("")
	}

	logger.Info("Client left ride", zap.String("client_id", clientID), zap.String("ride_id", rideID))
}

func (h *Hub) SendToUser(userID string, msg *Message) {
	h.Broadcast <- &BroadcastMessage{
		Target:   "user",
		TargetID: userID,
		Message:  msg,
	}
}

func (h *Hub) SendToRide(rideID string, msg *Message) {
	h.Broadcast <- &BroadcastMessage{
		Target:   "ride",
		TargetID: rideID,
		Message:  msg,
	}
}

func (h *Hub) SendToAll(msg *Message) {
	h.Broadcast <- &BroadcastMessage{
		Target:  "all",
		Message: msg,
	}
}

func (h *Hub) GetClient(clientID string) (*Client, bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	client, ok := h.clients[clientID]
	return client, ok
}

func (h *Hub) GetClientsInRide(rideID string) []*Client {
	h.mu.RLock()
	defer h.mu.RUnlock()

	clients := make([]*Client, 0)
	if ride, ok := h.rides[rideID]; ok {
		for _, client := range ride {
			clients = append(clients, client)
		}
	}
	return clients
}

func (h *Hub) GetClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

func (h *Hub) GetRideCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.rides)
}

func (h *Hub) AddClientToNegotiation(clientID, sessionID string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	client, ok := h.clients[clientID]
	if !ok {
		return
	}

	if _, ok := h.negotiations[sessionID]; !ok {
		h.negotiations[sessionID] = make(map[string]*Client)
	}

	h.negotiations[sessionID][clientID] = client

	logger.Info("Client joined negotiation", zap.String("client_id", clientID), zap.String("session_id", sessionID))
}

func (h *Hub) RemoveClientFromNegotiation(clientID, sessionID string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if negotiation, ok := h.negotiations[sessionID]; ok {
		delete(negotiation, clientID)
		if len(negotiation) == 0 {
			delete(h.negotiations, sessionID)
		}
	}

	logger.Info("Client left negotiation", zap.String("client_id", clientID), zap.String("session_id", sessionID))
}

func (h *Hub) SendToNegotiation(sessionID string, msg *Message) {
	h.Broadcast <- &BroadcastMessage{
		Target:   "negotiation",
		TargetID: sessionID,
		Message:  msg,
	}
}

func (h *Hub) GetClientsInNegotiation(sessionID string) []*Client {
	h.mu.RLock()
	defer h.mu.RUnlock()

	clients := make([]*Client, 0)
	if negotiation, ok := h.negotiations[sessionID]; ok {
		for _, client := range negotiation {
			clients = append(clients, client)
		}
	}
	return clients
}

func (h *Hub) GetNegotiationCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.negotiations)
}

func (h *Hub) CloseNegotiation(sessionID string, reason string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if negotiation, ok := h.negotiations[sessionID]; ok {
		closeMsg := &Message{
			Type: "negotiation.closed",
			Data: map[string]interface{}{
				"session_id": sessionID,
				"reason":     reason,
			},
		}

		for _, client := range negotiation {
			client.SendMessage(closeMsg)
		}

		delete(h.negotiations, sessionID)
		logger.Info("Negotiation closed", zap.String("session_id", sessionID), zap.String("reason", reason))
	}
}

func (h *Hub) SendToMultipleUsers(userIDs []string, msg *Message) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	for _, userID := range userIDs {
		if client, ok := h.clients[userID]; ok {
			client.SendMessage(msg)
		}
	}
}
