package notifications

import (
	"context"
	"errors"
	"fmt"
	"time"

	"go.uber.org/zap"

	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	"github.com/bikky-kc013/medi-ambulance/pkg/models"
	"github.com/bikky-kc013/medi-ambulance/pkg/resilience"
	"github.com/google/uuid"
)

const notificationRetryDelay = 2 * time.Minute

var ErrNotificationQueued = errors.New("notification queued for retry")

type Service struct {
	repo            RepositoryInterface
	firebaseClient  FirebaseClientInterface
	twilioClient    TwilioClientInterface
	emailClient     EmailClientInterface
	firebaseBreaker *resilience.CircuitBreaker
	twilioBreaker   *resilience.CircuitBreaker
	emailBreaker    *resilience.CircuitBreaker
}

func NewService(repo RepositoryInterface, firebaseClient FirebaseClientInterface, twilioClient TwilioClientInterface, emailClient EmailClientInterface) *Service {
	return &Service{
		repo:           repo,
		firebaseClient: firebaseClient,
		twilioClient:   twilioClient,
		emailClient:    emailClient,
	}
}

// NewServiceWithClients creates a new Service with production clients (for main.go)
func NewServiceWithClients(repo *Repository, firebaseClient *FirebaseClient, twilioClient *TwilioClient, emailClient *EmailClient) *Service {
	return &Service{
		repo:           repo,
		firebaseClient: firebaseClient,
		twilioClient:   twilioClient,
		emailClient:    emailClient,
	}
}

// SetCircuitBreakers wires circuit breakers for downstream providers.
func (s *Service) SetCircuitBreakers(firebaseBreaker, twilioBreaker, emailBreaker *resilience.CircuitBreaker) {
	s.firebaseBreaker = firebaseBreaker
	s.twilioBreaker = twilioBreaker
	s.emailBreaker = emailBreaker
}

// SendNotification sends a notification through the specified channel
func (s *Service) SendNotification(ctx context.Context, userID uuid.UUID, notifType, channel, title, body string, data map[string]interface{}) (*models.Notification, error) {
	notification := &models.Notification{
		ID:      uuid.New(),
		UserID:  userID,
		Type:    notifType,
		Channel: channel,
		Title:   title,
		Body:    body,
		Data:    data,
		Status:  "pending",
	}

	// Save notification to database
	err := s.repo.CreateNotification(ctx, notification)
	if err != nil {
		return nil, err
	}

	// Send notification asynchronously
	go s.processNotification(context.Background(), notification)

	return notification, nil
}

// processNotification sends the notification through the appropriate channel
func (s *Service) processNotification(ctx context.Context, notification *models.Notification) {
	var err error

	switch notification.Channel {
	case "push":
		err = s.sendPushNotification(ctx, notification)
	case "sms":
		err = s.sendSMSNotification(ctx, notification)
	case "email":
		err = s.sendEmailNotification(ctx, notification)
	default:
		err = fmt.Errorf("unsupported notification channel: %s", notification.Channel)
	}

	if err != nil {
		if errors.Is(err, ErrNotificationQueued) {
			logger.Get().Warn("Notification queued for retry",
				zap.String("notification_id", notification.ID.String()),
				zap.String("channel", notification.Channel))
			return
		}

		logger.Get().Error("Failed to send notification",
			zap.String("notification_id", notification.ID.String()),
			zap.String("channel", notification.Channel),
			zap.Error(err))

		errMsg := err.Error()
		if updateErr := s.repo.UpdateNotificationStatus(ctx, notification.ID, "failed", &errMsg); updateErr != nil {
			logger.Get().Error("Failed to update notification status to failed",
				zap.String("notification_id", notification.ID.String()),
				zap.Error(updateErr))
		}
		return
	}

	if updateErr := s.repo.UpdateNotificationStatus(ctx, notification.ID, "sent", nil); updateErr != nil {
		logger.Get().Error("Failed to update notification status to sent",
			zap.String("notification_id", notification.ID.String()),
			zap.Error(updateErr))
	}
	logger.Get().Info("Notification sent successfully",
		zap.String("notification_id", notification.ID.String()),
		zap.String("channel", notification.Channel),
		zap.String("user_id", notification.UserID.String()))
}

// sendPushNotification sends a push notification via Firebase
func (s *Service) sendPushNotification(ctx context.Context, notification *models.Notification) error {
	if s.firebaseClient == nil {
		return fmt.Errorf("firebase client not initialized")
	}

	// Get user's device tokens
	tokens, err := s.repo.GetUserDeviceTokens(ctx, notification.UserID)
	if err != nil {
		return err
	}

	if len(tokens) == 0 {
		return fmt.Errorf("no device tokens found for user")
	}

	// Convert data map to string map for Firebase
	dataStr := make(map[string]string)
	for key, value := range notification.Data {
		dataStr[key] = fmt.Sprintf("%v", value)
	}

	return s.executeWithBreaker(ctx, s.firebaseBreaker, notification, "push", func() error {
		_, err = s.firebaseClient.SendMulticastNotification(
			ctx,
			tokens,
			notification.Title,
			notification.Body,
			dataStr,
		)
		return err
	})
}

// sendSMSNotification sends an SMS notification via Twilio
func (s *Service) sendSMSNotification(ctx context.Context, notification *models.Notification) error {
	if s.twilioClient == nil {
		return fmt.Errorf("twilio client not initialized")
	}

	// Get user's phone number
	phoneNumber, err := s.repo.GetUserPhoneNumber(ctx, notification.UserID)
	if err != nil {
		return err
	}

	// Format message
	message := fmt.Sprintf("%s: %s", notification.Title, notification.Body)

	return s.executeWithBreaker(ctx, s.twilioBreaker, notification, "sms", func() error {
		_, err = s.twilioClient.SendSMS(phoneNumber, message)
		return err
	})
}

// sendEmailNotification sends an email notification
func (s *Service) sendEmailNotification(ctx context.Context, notification *models.Notification) error {
	if s.emailClient == nil {
		return fmt.Errorf("email client not initialized")
	}

	// Get user's email
	email, err := s.repo.GetUserEmail(ctx, notification.UserID)
	if err != nil {
		return err
	}

	return s.executeWithBreaker(ctx, s.emailBreaker, notification, "email", func() error {
		switch notification.Type {
		case "ride_confirmed":
			if data, ok := notification.Data["details"].(map[string]interface{}); ok {
				return s.emailClient.SendRideConfirmationEmail(email, "User", data)
			}
			return s.emailClient.SendHTMLEmail(email, notification.Title, notification.Body)
		case "ride_receipt":
			if data, ok := notification.Data["receipt"].(map[string]interface{}); ok {
				return s.emailClient.SendReceiptEmail(email, "User", data)
			}
			return s.emailClient.SendHTMLEmail(email, notification.Title, notification.Body)
		default:
			return s.emailClient.SendEmail(email, notification.Title, notification.Body)
		}
	})
}

// NotifyRideRequested notifies driver about a new ride request
func (s *Service) NotifyRideRequested(ctx context.Context, driverID, rideID uuid.UUID, pickupLocation string) error {
	data := map[string]interface{}{
		"ride_id":         rideID.String(),
		"pickup_location": pickupLocation,
		"action":          "ride_requested",
	}

	// Send push notification
	_, err := s.SendNotification(ctx, driverID, "ride_requested", "push",
		"New Ride Request",
		fmt.Sprintf("New ride request from %s", pickupLocation),
		data)

	if err != nil {
		return err
	}

	// Also send SMS for critical notification
	if _, err := s.SendNotification(ctx, driverID, "ride_requested", "sms",
		"New Ride Request",
		"New ride request nearby. Check your app!",
		data); err != nil {
		logger.Get().Warn("Failed to send SMS notification for ride request",
			zap.String("driver_id", driverID.String()),
			zap.Error(err))
	}

	return nil
}

// NotifyRideAccepted notifies rider that driver accepted the ride
func (s *Service) NotifyRideAccepted(ctx context.Context, riderID uuid.UUID, driverName string, eta int) error {
	data := map[string]interface{}{
		"driver_name": driverName,
		"eta":         eta,
		"action":      "ride_accepted",
	}

	_, err := s.SendNotification(ctx, riderID, "ride_accepted", "push",
		"Driver Found!",
		fmt.Sprintf("%s will pick you up in %d minutes", driverName, eta),
		data)

	return err
}

// NotifyRideStarted notifies rider that ride has started
func (s *Service) NotifyRideStarted(ctx context.Context, riderID uuid.UUID) error {
	data := map[string]interface{}{
		"action": "ride_started",
	}

	_, err := s.SendNotification(ctx, riderID, "ride_started", "push",
		"Ride Started",
		"Your ride has started. Enjoy your trip!",
		data)

	return err
}

// NotifyRideCompleted notifies both rider and driver about ride completion
func (s *Service) NotifyRideCompleted(ctx context.Context, riderID, driverID uuid.UUID, fare float64) error {
	// Notify rider
	riderData := map[string]interface{}{
		"fare":   fare,
		"action": "ride_completed",
	}

	_, err := s.SendNotification(ctx, riderID, "ride_completed", "push",
		"Ride Completed",
		fmt.Sprintf("Your ride is complete. Total fare: $%.2f", fare),
		riderData)

	if err != nil {
		logger.Get().Error("Failed to notify rider", zap.Error(err))
	}

	// Send receipt email
	receiptData := map[string]interface{}{
		"receipt": map[string]interface{}{
			"Fare":   fmt.Sprintf("$%.2f", fare),
			"Date":   time.Now().Format("Jan 02, 2006 3:04 PM"),
			"Status": "Completed",
		},
	}
	if _, err := s.SendNotification(ctx, riderID, "ride_receipt", "email",
		"Your Ride Receipt",
		"",
		receiptData); err != nil {
		logger.Get().Warn("Failed to send ride receipt email",
			zap.String("rider_id", riderID.String()),
			zap.Float64("fare", fare),
			zap.Error(err))
	}

	// Notify driver
	driverData := map[string]interface{}{
		"earnings": fare * 0.8, // 80% for driver, 20% commission
		"action":   "ride_completed",
	}

	_, err = s.SendNotification(ctx, driverID, "ride_completed", "push",
		"Ride Completed",
		fmt.Sprintf("Ride completed. You earned $%.2f", fare*0.8),
		driverData)

	return err
}

// NotifyRideCancelled notifies about ride cancellation
func (s *Service) NotifyRideCancelled(ctx context.Context, userID uuid.UUID, cancelledBy string) error {
	data := map[string]interface{}{
		"cancelled_by": cancelledBy,
		"action":       "ride_cancelled",
	}

	_, err := s.SendNotification(ctx, userID, "ride_cancelled", "push",
		"Ride Cancelled",
		fmt.Sprintf("Ride was cancelled by %s", cancelledBy),
		data)

	return err
}

// NotifyPaymentReceived notifies user about payment confirmation
func (s *Service) NotifyPaymentReceived(ctx context.Context, userID uuid.UUID, amount float64) error {
	data := map[string]interface{}{
		"amount": amount,
		"action": "payment_received",
	}

	_, err := s.SendNotification(ctx, userID, "payment_received", "push",
		"Payment Received",
		fmt.Sprintf("Payment of $%.2f has been received", amount),
		data)

	return err
}

// GetUserNotifications retrieves user's notifications
func (s *Service) GetUserNotifications(ctx context.Context, userID uuid.UUID, limit, offset int) ([]*models.Notification, int64, error) {
	return s.repo.GetUserNotificationsWithTotal(ctx, userID, limit, offset)
}

// MarkAsRead marks a notification as read
func (s *Service) MarkAsRead(ctx context.Context, notificationID uuid.UUID) error {
	return s.repo.MarkNotificationAsRead(ctx, notificationID)
}

// GetUnreadCount gets count of unread notifications
func (s *Service) GetUnreadCount(ctx context.Context, userID uuid.UUID) (int, error) {
	return s.repo.GetUnreadNotificationCount(ctx, userID)
}

// ProcessPendingNotifications processes queued notifications (for scheduled notifications)
func (s *Service) ProcessPendingNotifications(ctx context.Context) error {
	notifications, err := s.repo.GetPendingNotifications(ctx, 100)
	if err != nil {
		return err
	}

	for _, notification := range notifications {
		go s.processNotification(ctx, notification)
	}

	logger.Get().Info("Processed pending notifications", zap.Int("count", len(notifications)))
	return nil
}

// ScheduleNotification schedules a notification to be sent at a specific time
func (s *Service) ScheduleNotification(ctx context.Context, userID uuid.UUID, notifType, channel, title, body string, data map[string]interface{}, scheduledAt time.Time) (*models.Notification, error) {
	notification := &models.Notification{
		ID:          uuid.New(),
		UserID:      userID,
		Type:        notifType,
		Channel:     channel,
		Title:       title,
		Body:        body,
		Data:        data,
		Status:      "pending",
		ScheduledAt: &scheduledAt,
	}

	err := s.repo.CreateNotification(ctx, notification)
	if err != nil {
		return nil, err
	}

	return notification, nil
}

// SendBulkNotification sends notification to multiple users
func (s *Service) SendBulkNotification(ctx context.Context, userIDs []uuid.UUID, notifType, channel, title, body string, data map[string]interface{}) error {
	for _, userID := range userIDs {
		_, err := s.SendNotification(ctx, userID, notifType, channel, title, body, data)
		if err != nil {
			logger.Get().Error("Failed to send bulk notification",
				zap.String("user_id", userID.String()),
				zap.Error(err))
		}
	}

	logger.Get().Info("Sent bulk notifications", zap.Int("count", len(userIDs)))
	return nil
}

func (s *Service) executeWithBreaker(ctx context.Context, breaker *resilience.CircuitBreaker, notification *models.Notification, channel string, operation func() error) error {
	if breaker == nil {
		return operation()
	}

	_, err := breaker.Execute(ctx, func(ctx context.Context) (interface{}, error) {
		return nil, operation()
	})
	if err == nil {
		return nil
	}

	if errors.Is(err, resilience.ErrCircuitOpen) {
		s.scheduleNotificationRetry(ctx, notification, channel, err)
		return ErrNotificationQueued
	}

	return err
}

func (s *Service) scheduleNotificationRetry(ctx context.Context, notification *models.Notification, channel string, reason error) {
	retryAt := time.Now().Add(notificationRetryDelay)
	message := fmt.Sprintf("%s channel unavailable: %v", channel, reason)

	if err := s.repo.ScheduleNotificationRetry(ctx, notification.ID, retryAt, message); err != nil {
		logger.Get().Error("Failed to schedule notification retry",
			zap.String("notification_id", notification.ID.String()),
			zap.String("channel", channel),
			zap.Error(err))
		return
	}

	logger.Get().Info("Notification scheduled for retry",
		zap.String("notification_id", notification.ID.String()),
		zap.String("channel", channel),
		zap.Time("retry_at", retryAt))
}
