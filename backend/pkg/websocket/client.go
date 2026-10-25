package websocket

import (
	"encoding/json"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"go.uber.org/zap"
)

const (
	writeWait = 10 * time.Second

	pongWait = 60 * time.Second

	pingPeriod = (pongWait * 9) / 10

	maxMessageSize = 512 * 1024
)

type Message struct {
	Type      string                 `json:"type"`
	RideID    string                 `json:"ride_id,omitempty"`
	UserID    string                 `json:"user_id,omitempty"`
	Timestamp time.Time              `json:"timestamp"`
	Data      map[string]interface{} `json:"data"`
}

type Client struct {
	ID        string
	RideID    string
	Role      string
	Conn      *websocket.Conn
	Send      chan *Message
	Hub       *Hub
	logger    *zap.Logger
	mu        sync.RWMutex
	closeOnce sync.Once
	closed    bool
}

func NewClient(id string, conn *websocket.Conn, hub *Hub, role string, logger *zap.Logger) *Client {
	return &Client{
		ID:     id,
		Conn:   conn,
		Send:   make(chan *Message, 256),
		Hub:    hub,
		Role:   role,
		logger: logger,
	}
}

func (c *Client) ReadPump() {
	defer func() {
		c.Hub.Unregister <- c
		c.Conn.Close()
	}()

	c.Conn.SetReadDeadline(time.Now().Add(pongWait))
	c.Conn.SetReadLimit(maxMessageSize)
	c.Conn.SetPongHandler(func(string) error {
		c.Conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		var msg Message
		err := c.Conn.ReadJSON(&msg)
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				c.logger.Error("WebSocket error", zap.Error(err))
			}
			break
		}

		msg.Timestamp = time.Now()
		msg.UserID = c.ID

		c.Hub.HandleMessage(c, &msg)
	}
}

func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.Send:
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			err := c.Conn.WriteJSON(message)
			if err != nil {
				return
			}

		case <-ticker.C:
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (c *Client) SendMessage(msg *Message) {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return
	}
	c.mu.Unlock()

	select {
	case c.Send <- msg:
	default:
		c.logger.Warn("client channel full, closing connection", zap.String("client_id", c.ID))
		c.mu.Lock()
		c.closed = true
		c.mu.Unlock()
		c.closeOnce.Do(func() {
			close(c.Send)
		})
		c.Hub.Unregister <- c
	}
}

func (c *Client) SetRide(rideID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.RideID = rideID
}

func (c *Client) GetRide() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.RideID
}

func (m *Message) MarshalJSON() ([]byte, error) {
	type Alias Message
	return json.Marshal(&struct {
		Timestamp string `json:"timestamp"`
		*Alias
	}{
		Timestamp: m.Timestamp.Format(time.RFC3339),
		Alias:     (*Alias)(m),
	})
}

func (m *Message) UnmarshalJSON(data []byte) error {
	type Alias Message
	aux := &struct {
		Timestamp string `json:"timestamp"`
		*Alias
	}{
		Alias: (*Alias)(m),
	}

	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}

	if aux.Timestamp != "" {
		t, err := time.Parse(time.RFC3339, aux.Timestamp)
		if err != nil {
			return err
		}
		m.Timestamp = t
	}

	return nil
}
