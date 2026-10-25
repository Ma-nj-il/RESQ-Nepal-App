package eventbus

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	"github.com/google/uuid"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"go.uber.org/zap"
)

const (
	SubjectRideRequested = "rides.requested"
	SubjectRideAccepted  = "rides.accepted"
	SubjectRideStarted   = "rides.started"
	SubjectRideCompleted = "rides.completed"
	SubjectRideCancelled = "rides.cancelled"

	SubjectPaymentProcessed = "payments.processed"
	SubjectPaymentFailed    = "payments.failed"

	SubjectDriverLocationUpdated = "drivers.location.updated"
	SubjectDriverOnline          = "drivers.online"
	SubjectDriverOffline         = "drivers.offline"

	SubjectFraudDetected = "fraud.detected"
)

type Event struct {
	ID        string          `json:"id"`
	Type      string          `json:"type"`
	Source    string          `json:"source"`
	Timestamp time.Time       `json:"timestamp"`
	Data      json.RawMessage `json:"data"`
}

func NewEvent(eventType, source string, data interface{}) (*Event, error) {
	raw, err := json.Marshal(data)
	if err != nil {
		return nil, fmt.Errorf("marshal event data: %w", err)
	}
	return &Event{
		ID:        uuid.New().String(),
		Type:      eventType,
		Source:    source,
		Timestamp: time.Now().UTC(),
		Data:      raw,
	}, nil
}

type HandlerFunc func(ctx context.Context, event *Event) error

type Config struct {
	URL        string
	Name       string // client connection name
	StreamName string // JetStream stream name (default: "MEDIAMBULANCE")
}

func DefaultConfig() Config {
	return Config{
		URL:        nats.DefaultURL,
		Name:       "medi-ambulance",
		StreamName: "MEDIAMBULANCE",
	}
}

type Bus struct {
	conn *nats.Conn
	js   jetstream.JetStream
	cfg  Config
	subs []jetstream.ConsumeContext
}

func New(cfg Config) (*Bus, error) {
	nc, err := nats.Connect(cfg.URL,
		nats.Name(cfg.Name),
		nats.RetryOnFailedConnect(true),
		nats.MaxReconnects(-1),
		nats.ReconnectWait(2*time.Second),
		nats.DisconnectErrHandler(func(_ *nats.Conn, err error) {
			if err != nil {
				logger.Warn("NATS disconnected", zap.Error(err))
			}
		}),
		nats.ReconnectHandler(func(_ *nats.Conn) {
			logger.Info("NATS reconnected")
		}),
	)
	if err != nil {
		return nil, fmt.Errorf("nats connect: %w", err)
	}

	js, err := jetstream.New(nc)
	if err != nil {
		nc.Close()
		return nil, fmt.Errorf("jetstream init: %w", err)
	}

	streamName := cfg.StreamName
	if streamName == "" {
		streamName = "MEDIAMBULANCE"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	_, err = js.CreateOrUpdateStream(ctx, jetstream.StreamConfig{
		Name:      streamName,
		Subjects:  []string{"rides.>", "payments.>", "drivers.>", "fraud.>"},
		Storage:   jetstream.FileStorage,
		Retention: jetstream.InterestPolicy,
		MaxAge:    72 * time.Hour,
		Replicas:  1,
	})
	if err != nil {
		nc.Close()
		return nil, fmt.Errorf("create stream: %w", err)
	}

	logger.Info("NATS event bus connected",
		zap.String("url", cfg.URL),
		zap.String("stream", streamName),
	)

	return &Bus{conn: nc, js: js, cfg: cfg}, nil
}

func (b *Bus) Publish(ctx context.Context, subject string, event *Event) error {
	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshal event: %w", err)
	}

	_, err = b.js.Publish(ctx, subject, data,
		jetstream.WithMsgID(event.ID),
	)
	if err != nil {
		return fmt.Errorf("publish to %s: %w", subject, err)
	}

	logger.Debug("event published",
		zap.String("subject", subject),
		zap.String("event_id", event.ID),
		zap.String("type", event.Type),
	)
	return nil
}

func (b *Bus) Subscribe(ctx context.Context, subject, consumerName string, handler HandlerFunc) error {
	streamName := b.cfg.StreamName
	if streamName == "" {
		streamName = "MEDIAMBULANCE"
	}

	consumer, err := b.js.CreateOrUpdateConsumer(ctx, streamName, jetstream.ConsumerConfig{
		Name:          consumerName,
		Durable:       consumerName,
		FilterSubject: subject,
		AckPolicy:     jetstream.AckExplicitPolicy,
		AckWait:       30 * time.Second,
		MaxDeliver:    5,
		DeliverPolicy: jetstream.DeliverNewPolicy,
	})
	if err != nil {
		return fmt.Errorf("create consumer %s: %w", consumerName, err)
	}

	cc, err := consumer.Consume(func(msg jetstream.Msg) {
		var event Event
		if err := json.Unmarshal(msg.Data(), &event); err != nil {
			logger.Warn("failed to unmarshal event", zap.Error(err))
			msg.Term()
			return
		}

		if err := handler(ctx, &event); err != nil {
			logger.Warn("event handler error, will retry",
				zap.String("event_id", event.ID),
				zap.String("type", event.Type),
				zap.Error(err),
			)
			msg.Nak()
			return
		}

		msg.Ack()
	})
	if err != nil {
		return fmt.Errorf("consume %s: %w", consumerName, err)
	}

	b.subs = append(b.subs, cc)
	logger.Info("subscribed to events",
		zap.String("subject", subject),
		zap.String("consumer", consumerName),
	)
	return nil
}

func (b *Bus) SubscribeAll(ctx context.Context, subjectPattern, consumerName string, handler HandlerFunc) error {
	return b.Subscribe(ctx, subjectPattern, consumerName, handler)
}

func (b *Bus) Close() {
	for _, sub := range b.subs {
		sub.Stop()
	}
	if b.conn != nil {
		b.conn.Drain()
	}
	logger.Info("NATS event bus closed")
}

func (b *Bus) Connected() bool {
	return b.conn != nil && b.conn.IsConnected()
}

func (b *Bus) Conn() *nats.Conn {
	return b.conn
}
