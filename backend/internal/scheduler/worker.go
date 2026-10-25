package scheduler

import (
	"context"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/config"
	"github.com/bikky-kc013/medi-ambulance/pkg/httpclient"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

const (
	checkInterval              = 1 * time.Minute
	lookAheadMinutes           = 30
	demandZonesRefreshInterval = 15 * time.Minute
	driverPerfRefreshInterval  = 1 * time.Hour
	revenueRefreshInterval     = 24 * time.Hour
	rideExpiryThreshold        = 5 * time.Minute
)

type Worker struct {
	db                     Database
	logger                 *zap.Logger
	notificationsClient    *httpclient.Client
	done                   chan struct{}
	lastDemandZonesRefresh time.Time
	lastDriverPerfRefresh  time.Time
	lastRevenueRefresh     time.Time
}

func NewWorker(timeOutCfg config.TimeoutConfig, db Database, logger *zap.Logger, notificationsServiceURL string, httpClientTimeout ...time.Duration) *Worker {
	var notificationsClient *httpclient.Client
	if notificationsServiceURL != "" {
		notificationsClient = httpclient.NewClient(timeOutCfg, notificationsServiceURL, httpClientTimeout...)
	}

	return &Worker{
		db:                  db,
		logger:              logger,
		notificationsClient: notificationsClient,
		done:                make(chan struct{}),
	}
}

func (w *Worker) Start(ctx context.Context) {
	w.logger.Info("Starting scheduler worker with maintenance tasks")

	ticker := time.NewTicker(checkInterval)
	defer ticker.Stop()

	w.processScheduledRides(ctx)
	w.expireStaleRides(ctx)
	w.refreshMaterializedViews(ctx)

	for {
		select {
		case <-ticker.C:
			w.processScheduledRides(ctx)
			w.expireStaleRides(ctx)
			w.refreshMaterializedViews(ctx)
		case <-ctx.Done():
			w.logger.Info("Scheduler worker stopped")
			return
		case <-w.done:
			w.logger.Info("Scheduler worker shutdown requested")
			return
		}
	}
}

func (w *Worker) Stop() {
	close(w.done)
}

func (w *Worker) processScheduledRides(ctx context.Context) {
	rides, err := w.getUpcomingScheduledRides(ctx, lookAheadMinutes)
	if err != nil {
		w.logger.Error("Failed to get upcoming scheduled rides", zap.Error(err))
		return
	}

	if len(rides) == 0 {
		w.logger.Debug("No scheduled rides to process")
		return
	}

	w.logger.Info("Processing scheduled rides", zap.Int("count", len(rides)))

	for _, ride := range rides {
		timeUntilRide := time.Until(ride.ScheduledAt)

		if timeUntilRide <= 5*time.Minute {
			err := w.activateScheduledRide(ctx, ride.ID)
			if err != nil {
				w.logger.Error("Failed to activate scheduled ride",
					zap.String("ride_id", ride.ID.String()),
					zap.Error(err))
				continue
			}

			w.logger.Info("Activated scheduled ride",
				zap.String("ride_id", ride.ID.String()),
				zap.Time("scheduled_at", ride.ScheduledAt))
		} else if timeUntilRide <= 30*time.Minute && !ride.NotificationSent {
			err := w.sendUpcomingRideNotification(ctx, ride.ID, ride.RiderID)
			if err != nil {
				w.logger.Error("Failed to send notification",
					zap.String("ride_id", ride.ID.String()),
					zap.Error(err))
				continue
			}

			w.logger.Info("Sent upcoming ride notification",
				zap.String("ride_id", ride.ID.String()),
				zap.String("rider_id", ride.RiderID.String()))
		}
	}
}

type ScheduledRide struct {
	ID               uuid.UUID
	RiderID          uuid.UUID
	ScheduledAt      time.Time
	PickupAddress    string
	DropoffAddress   string
	EstimatedFare    float64
	NotificationSent bool
}

func (w *Worker) getUpcomingScheduledRides(ctx context.Context, minutesAhead int) ([]*ScheduledRide, error) {
	query := `
		SELECT id, rider_id, scheduled_at, pickup_address, dropoff_address,
		       estimated_fare, scheduled_notification_sent
		FROM rides
		WHERE is_scheduled = true
		  AND status = 'requested'
		  AND scheduled_at <= NOW() + make_interval(mins => $1)
		  AND scheduled_at > NOW()
		ORDER BY scheduled_at ASC
	`

	rows, err := w.db.QueryContext(ctx, query, minutesAhead)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rides []*ScheduledRide
	for rows.Next() {
		ride := &ScheduledRide{}
		err := rows.Scan(
			&ride.ID,
			&ride.RiderID,
			&ride.ScheduledAt,
			&ride.PickupAddress,
			&ride.DropoffAddress,
			&ride.EstimatedFare,
			&ride.NotificationSent,
		)
		if err != nil {
			return nil, err
		}
		rides = append(rides, ride)
	}

	return rides, nil
}

func (w *Worker) activateScheduledRide(ctx context.Context, rideID uuid.UUID) error {
	query := `
		UPDATE rides
		SET is_scheduled = false,
		    requested_at = NOW(),
		    updated_at = NOW()
		WHERE id = $1
		  AND is_scheduled = true
		  AND status = 'requested'
	`

	result, err := w.db.ExecContext(ctx, query, rideID)
	if err != nil {
		return err
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		w.logger.Warn("No rows affected when activating scheduled ride",
			zap.String("ride_id", rideID.String()))
	}

	return nil
}

func (w *Worker) sendUpcomingRideNotification(ctx context.Context, rideID, riderID uuid.UUID) error {
	query := `
		UPDATE rides
		SET scheduled_notification_sent = true,
		    updated_at = NOW()
		WHERE id = $1
		  AND scheduled_notification_sent = false
	`

	result, err := w.db.ExecContext(ctx, query, rideID)
	if err != nil {
		return err
	}

	if n, _ := result.RowsAffected(); n == 0 {
		w.logger.Debug("Notification already sent for scheduled ride",
			zap.String("ride_id", rideID.String()))
		return nil
	}

	if w.notificationsClient != nil {
		notificationReq := map[string]interface{}{
			"user_id": riderID.String(),
			"type":    "scheduled_ride_reminder",
			"channel": "push",
			"title":   "Upcoming Ride Scheduled",
			"body":    "Your scheduled ride is coming up soon. Get ready!",
			"data": map[string]interface{}{
				"ride_id": rideID.String(),
				"action":  "view_ride",
			},
		}

		_, err := w.notificationsClient.Post(ctx, "/api/v1/notifications", notificationReq, nil)
		if err != nil {
			w.logger.Error("Failed to send notification via notifications service",
				zap.String("ride_id", rideID.String()),
				zap.String("rider_id", riderID.String()),
				zap.Error(err))
		} else {
			w.logger.Info("Notification sent successfully",
				zap.String("ride_id", rideID.String()),
				zap.String("rider_id", riderID.String()))
		}
	} else {
		w.logger.Warn("Notifications service client not configured, skipping notification",
			zap.String("ride_id", rideID.String()))
	}

	return nil
}

func (w *Worker) expireStaleRides(ctx context.Context) {
	query := `
		UPDATE rides
		SET status = 'cancelled',
		    cancellation_reason = 'expired: no driver accepted within timeout',
		    cancelled_at = NOW(),
		    updated_at = NOW()
		WHERE status = 'requested'
		  AND is_scheduled = false
		  AND requested_at < NOW() - make_interval(secs => $1)
	`

	result, err := w.db.ExecContext(ctx, query, rideExpiryThreshold.Seconds())
	if err != nil {
		w.logger.Error("Failed to expire stale rides", zap.Error(err))
		return
	}

	if expired, _ := result.RowsAffected(); expired > 0 {
		w.logger.Info("Expired stale ride requests",
			zap.Int64("count", expired),
			zap.Duration("threshold", rideExpiryThreshold))
	}
}

func (w *Worker) refreshMaterializedViews(ctx context.Context) {
	now := time.Now()

	if now.Sub(w.lastDemandZonesRefresh) >= demandZonesRefreshInterval {
		w.logger.Info("Refreshing demand zones materialized view")
		err := w.refreshView(ctx, "mv_demand_zones")
		if err != nil {
			w.logger.Error("Failed to refresh demand zones view", zap.Error(err))
		} else {
			w.lastDemandZonesRefresh = now
			w.logger.Info("Successfully refreshed demand zones view")
		}
	}

	if now.Sub(w.lastDriverPerfRefresh) >= driverPerfRefreshInterval {
		w.logger.Info("Refreshing driver performance materialized view")
		err := w.refreshView(ctx, "mv_driver_performance")
		if err != nil {
			w.logger.Error("Failed to refresh driver performance view", zap.Error(err))
		} else {
			w.lastDriverPerfRefresh = now
			w.logger.Info("Successfully refreshed driver performance view")
		}
	}

	if now.Sub(w.lastRevenueRefresh) >= revenueRefreshInterval {
		w.logger.Info("Refreshing revenue metrics materialized view")
		err := w.refreshView(ctx, "mv_revenue_metrics")
		if err != nil {
			w.logger.Error("Failed to refresh revenue metrics view", zap.Error(err))
		} else {
			w.lastRevenueRefresh = now
			w.logger.Info("Successfully refreshed revenue metrics view")
		}
	}
}

func (w *Worker) refreshView(ctx context.Context, viewName string) error {
	query := "REFRESH MATERIALIZED VIEW CONCURRENTLY " + viewName

	refreshCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	_, err := w.db.ExecContext(refreshCtx, query)
	return err
}
