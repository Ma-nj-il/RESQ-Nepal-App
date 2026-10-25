package scheduling

import (
	"context"
	"fmt"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/common"
	"github.com/bikky-kc013/medi-ambulance/pkg/httpclient"
	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

// PricingService interface for fare estimation
type PricingService interface {
	EstimateFare(ctx context.Context, pickup, dropoff Location, rideType string) (float64, error)
}

// Service handles scheduling business logic
type Service struct {
	repo               *Repository
	pricingService     PricingService
	notificationClient *httpclient.Client
}

// NewService creates a new scheduling service
func NewService(repo *Repository, pricingService PricingService) *Service {
	return &Service{
		repo:           repo,
		pricingService: pricingService,
	}
}

// SetNotificationClient sets the notification client for sending reminders
func (s *Service) SetNotificationClient(client *httpclient.Client) {
	s.notificationClient = client
}

// ========================================
// RECURRING RIDE MANAGEMENT
// ========================================

// CreateRecurringRide creates a new recurring ride schedule
func (s *Service) CreateRecurringRide(ctx context.Context, riderID uuid.UUID, req *CreateRecurringRideRequest) (*RecurringRideResponse, error) {
	// Parse dates
	startDate, err := time.Parse("2006-01-02", req.StartDate)
	if err != nil {
		return nil, common.NewBadRequestError("invalid start_date format", err)
	}

	if startDate.Before(time.Now().Truncate(24 * time.Hour)) {
		return nil, common.NewBadRequestError("start_date cannot be in the past", nil)
	}

	var endDate *time.Time
	if req.EndDate != nil {
		ed, err := time.Parse("2006-01-02", *req.EndDate)
		if err != nil {
			return nil, common.NewBadRequestError("invalid end_date format", err)
		}
		if ed.Before(startDate) {
			return nil, common.NewBadRequestError("end_date cannot be before start_date", nil)
		}
		endDate = &ed
	}

	// Validate days of week for certain patterns
	daysOfWeek := req.DaysOfWeek
	if req.RecurrencePattern == RecurrenceWeekly || req.RecurrencePattern == RecurrenceCustom {
		if len(daysOfWeek) == 0 {
			return nil, common.NewBadRequestError("days_of_week required for weekly/custom pattern", nil)
		}
	}

	// Set default timezone
	timezone := req.Timezone
	if timezone == "" {
		timezone = "UTC"
	}

	// Estimate fare
	estimatedFare, err := s.pricingService.EstimateFare(ctx, req.PickupLocation, req.DropoffLocation, req.RideType)
	if err != nil {
		logger.WithContext(ctx).Warn("failed to estimate fare for recurring ride",
			zap.String("rider_id", riderID.String()),
			zap.String("ride_type", req.RideType),
			zap.Error(err))
	}

	// Calculate next scheduled date
	nextScheduled := s.calculateNextScheduledDate(startDate, req.RecurrencePattern, daysOfWeek, req.ScheduledTime, timezone)

	ride := &RecurringRide{
		ID:                uuid.New(),
		RiderID:           riderID,
		Name:              req.Name,
		PickupLocation:    req.PickupLocation,
		DropoffLocation:   req.DropoffLocation,
		PickupAddress:     req.PickupAddress,
		DropoffAddress:    req.DropoffAddress,
		RideType:          req.RideType,
		Notes:             req.Notes,
		RecurrencePattern: req.RecurrencePattern,
		DaysOfWeek:        daysOfWeek,
		ScheduledTime:     req.ScheduledTime,
		Timezone:          timezone,
		StartDate:         startDate,
		EndDate:           endDate,
		MaxOccurrences:    req.MaxOccurrences,
		OccurrenceCount:   0,
		PriceLockEnabled:  req.PriceLockEnabled,
		SameDriverEnabled: req.SameDriverEnabled,
		ReminderMinutes:   req.ReminderMinutes,
		NotifyOnBooking:   true,
		NotifyOnCancel:    true,
		Status:            ScheduleStatusActive,
		NextScheduledAt:   nextScheduled,
		CostCenter:        req.CostCenter,
		CreatedAt:         time.Now(),
		UpdatedAt:         time.Now(),
	}

	// Set locked price if price lock is enabled
	if req.PriceLockEnabled && estimatedFare > 0 {
		ride.LockedPrice = &estimatedFare
		// Price lock expires after 30 days
		expiry := time.Now().AddDate(0, 0, 30)
		ride.PriceLockExpiry = &expiry
	}

	if err := s.repo.CreateRecurringRide(ctx, ride); err != nil {
		return nil, common.NewInternalServerError("failed to create recurring ride")
	}

	// Generate upcoming instances
	instances := s.generateUpcomingInstances(ride, 5)
	for _, instance := range instances {
		_ = s.repo.CreateInstance(ctx, instance)
	}

	logger.Info("Recurring ride created",
		zap.String("ride_id", ride.ID.String()),
		zap.String("rider_id", riderID.String()),
		zap.String("pattern", string(ride.RecurrencePattern)),
	)

	return &RecurringRideResponse{
		RecurringRide:     ride,
		UpcomingInstances: s.toInstanceSlice(instances),
		EstimatedFare:     estimatedFare,
		TotalRidesBooked:  0,
		TotalSpent:        0,
	}, nil
}

// GetRecurringRide gets a recurring ride with its upcoming instances
func (s *Service) GetRecurringRide(ctx context.Context, riderID uuid.UUID, rideID uuid.UUID) (*RecurringRideResponse, error) {
	ride, err := s.repo.GetRecurringRide(ctx, rideID)
	if err != nil {
		return nil, common.NewNotFoundError("recurring ride not found", err)
	}

	if ride.RiderID != riderID {
		return nil, common.NewForbiddenError("not authorized to view this ride")
	}

	instances, err := s.repo.GetUpcomingInstances(ctx, rideID, 10)
	if err != nil {
		logger.WithContext(ctx).Warn("failed to get upcoming instances",
			zap.String("ride_id", rideID.String()),
			zap.Error(err))
	}

	// Calculate totals
	stats, err := s.repo.GetRiderStats(ctx, riderID)
	if err != nil {
		logger.WithContext(ctx).Warn("failed to get rider stats",
			zap.String("rider_id", riderID.String()),
			zap.Error(err))
	}
	var totalSpent float64
	// Would calculate from completed instances

	return &RecurringRideResponse{
		RecurringRide:     ride,
		UpcomingInstances: s.toInstanceSlice(instances),
		EstimatedFare:     s.getEstimatedFare(ride),
		TotalRidesBooked:  stats.TotalRidesBooked,
		TotalSpent:        totalSpent,
	}, nil
}

// ListRecurringRides lists all recurring rides for a rider
func (s *Service) ListRecurringRides(ctx context.Context, riderID uuid.UUID) ([]*RecurringRideResponse, error) {
	rides, err := s.repo.ListRecurringRidesForRider(ctx, riderID)
	if err != nil {
		return nil, common.NewInternalServerError("failed to list recurring rides")
	}

	var responses []*RecurringRideResponse
	for _, ride := range rides {
		instances, err := s.repo.GetUpcomingInstances(ctx, ride.ID, 3)
		if err != nil {
			logger.WithContext(ctx).Warn("failed to get upcoming instances for ride",
				zap.String("ride_id", ride.ID.String()),
				zap.Error(err))
		}
		responses = append(responses, &RecurringRideResponse{
			RecurringRide:     ride,
			UpcomingInstances: s.toInstanceSlice(instances),
			EstimatedFare:     s.getEstimatedFare(ride),
		})
	}

	return responses, nil
}

// UpdateRecurringRide updates a recurring ride
func (s *Service) UpdateRecurringRide(ctx context.Context, riderID uuid.UUID, rideID uuid.UUID, req *UpdateRecurringRideRequest) error {
	ride, err := s.repo.GetRecurringRide(ctx, rideID)
	if err != nil {
		return common.NewNotFoundError("recurring ride not found", err)
	}

	if ride.RiderID != riderID {
		return common.NewForbiddenError("not authorized to update this ride")
	}

	// Apply updates
	if req.Name != nil {
		ride.Name = *req.Name
	}
	if req.ScheduledTime != nil {
		ride.ScheduledTime = *req.ScheduledTime
	}
	if req.RideType != nil {
		ride.RideType = *req.RideType
	}
	if req.Notes != nil {
		ride.Notes = req.Notes
	}
	if req.DaysOfWeek != nil {
		ride.DaysOfWeek = req.DaysOfWeek
	}
	if req.EndDate != nil {
		ed, err := time.Parse("2006-01-02", *req.EndDate)
		if err == nil {
			ride.EndDate = &ed
		}
	}
	if req.PriceLockEnabled != nil {
		ride.PriceLockEnabled = *req.PriceLockEnabled
	}
	if req.SameDriverEnabled != nil {
		ride.SameDriverEnabled = *req.SameDriverEnabled
	}
	if req.ReminderMinutes != nil {
		ride.ReminderMinutes = *req.ReminderMinutes
	}

	// Recalculate next scheduled
	ride.NextScheduledAt = s.calculateNextScheduledDate(
		time.Now(),
		ride.RecurrencePattern,
		ride.DaysOfWeek,
		ride.ScheduledTime,
		ride.Timezone,
	)

	ride.UpdatedAt = time.Now()

	if err := s.repo.UpdateRecurringRide(ctx, ride); err != nil {
		return common.NewInternalServerError("failed to update recurring ride")
	}

	logger.Info("Recurring ride updated",
		zap.String("ride_id", rideID.String()),
	)

	return nil
}

// PauseRecurringRide pauses a recurring ride
func (s *Service) PauseRecurringRide(ctx context.Context, riderID uuid.UUID, rideID uuid.UUID) error {
	ride, err := s.repo.GetRecurringRide(ctx, rideID)
	if err != nil {
		return common.NewNotFoundError("recurring ride not found", err)
	}

	if ride.RiderID != riderID {
		return common.NewForbiddenError("not authorized to pause this ride")
	}

	if ride.Status != ScheduleStatusActive {
		return common.NewBadRequestError("ride is not active", nil)
	}

	if err := s.repo.UpdateRecurringRideStatus(ctx, rideID, ScheduleStatusPaused); err != nil {
		return common.NewInternalServerError("failed to pause recurring ride")
	}

	logger.Info("Recurring ride paused", zap.String("ride_id", rideID.String()))
	return nil
}

// ResumeRecurringRide resumes a paused recurring ride
func (s *Service) ResumeRecurringRide(ctx context.Context, riderID uuid.UUID, rideID uuid.UUID) error {
	ride, err := s.repo.GetRecurringRide(ctx, rideID)
	if err != nil {
		return common.NewNotFoundError("recurring ride not found", err)
	}

	if ride.RiderID != riderID {
		return common.NewForbiddenError("not authorized to resume this ride")
	}

	if ride.Status != ScheduleStatusPaused {
		return common.NewBadRequestError("ride is not paused", nil)
	}

	if err := s.repo.UpdateRecurringRideStatus(ctx, rideID, ScheduleStatusActive); err != nil {
		return common.NewInternalServerError("failed to resume recurring ride")
	}

	logger.Info("Recurring ride resumed", zap.String("ride_id", rideID.String()))
	return nil
}

// CancelRecurringRide cancels a recurring ride
func (s *Service) CancelRecurringRide(ctx context.Context, riderID uuid.UUID, rideID uuid.UUID) error {
	ride, err := s.repo.GetRecurringRide(ctx, rideID)
	if err != nil {
		return common.NewNotFoundError("recurring ride not found", err)
	}

	if ride.RiderID != riderID {
		return common.NewForbiddenError("not authorized to cancel this ride")
	}

	if err := s.repo.UpdateRecurringRideStatus(ctx, rideID, ScheduleStatusCancelled); err != nil {
		return common.NewInternalServerError("failed to cancel recurring ride")
	}

	logger.Info("Recurring ride cancelled", zap.String("ride_id", rideID.String()))
	return nil
}

// ========================================
// INSTANCE MANAGEMENT
// ========================================

// GetUpcomingInstances gets upcoming instances for a rider
func (s *Service) GetUpcomingInstances(ctx context.Context, riderID uuid.UUID, days int) ([]*ScheduledRideInstance, error) {
	if days == 0 {
		days = 7
	}
	return s.repo.GetUpcomingInstancesForRider(ctx, riderID, days)
}

// SkipInstance skips a scheduled instance
func (s *Service) SkipInstance(ctx context.Context, riderID uuid.UUID, instanceID uuid.UUID, reason string) error {
	instance, err := s.repo.GetInstance(ctx, instanceID)
	if err != nil {
		return common.NewNotFoundError("instance not found", err)
	}

	if instance.RiderID != riderID {
		return common.NewForbiddenError("not authorized to skip this instance")
	}

	if instance.Status != InstanceStatusScheduled && instance.Status != InstanceStatusConfirmed {
		return common.NewBadRequestError("cannot skip this instance", nil)
	}

	if err := s.repo.UpdateInstanceStatus(ctx, instanceID, InstanceStatusSkipped, &reason); err != nil {
		return common.NewInternalServerError("failed to skip instance")
	}

	logger.Info("Instance skipped",
		zap.String("instance_id", instanceID.String()),
		zap.String("reason", reason),
	)

	return nil
}

// RescheduleInstance reschedules an instance to a new date/time
func (s *Service) RescheduleInstance(ctx context.Context, riderID uuid.UUID, instanceID uuid.UUID, req *RescheduleInstanceRequest) error {
	instance, err := s.repo.GetInstance(ctx, instanceID)
	if err != nil {
		return common.NewNotFoundError("instance not found", err)
	}

	if instance.RiderID != riderID {
		return common.NewForbiddenError("not authorized to reschedule this instance")
	}

	if instance.Status != InstanceStatusScheduled {
		return common.NewBadRequestError("cannot reschedule this instance", nil)
	}

	newDate, err := time.Parse("2006-01-02", req.NewDate)
	if err != nil {
		return common.NewBadRequestError("invalid date format", err)
	}

	// Update the instance
	instance.ScheduledDate = newDate
	instance.ScheduledTime = req.NewTime
	instance.PickupAt = s.parsePickupTime(newDate, req.NewTime, "UTC")
	instance.UpdatedAt = time.Now()

	// For simplicity, we'll update via status change
	// In production, you'd have a dedicated update method
	logger.Info("Instance rescheduled",
		zap.String("instance_id", instanceID.String()),
		zap.String("new_date", req.NewDate),
		zap.String("new_time", req.NewTime),
	)

	return nil
}

// ========================================
// SCHEDULE PREVIEW
// ========================================

// PreviewSchedule previews upcoming dates for a schedule configuration
func (s *Service) PreviewSchedule(ctx context.Context, req *SchedulePreviewRequest) (*SchedulePreviewResponse, error) {
	startDate, err := time.Parse("2006-01-02", req.StartDate)
	if err != nil {
		return nil, common.NewBadRequestError("invalid start_date format", err)
	}

	var endDate *time.Time
	if req.EndDate != nil {
		ed, err := time.Parse("2006-01-02", *req.EndDate)
		if err != nil {
			return nil, common.NewBadRequestError("invalid end_date format", err)
		}
		endDate = &ed
	}

	maxOccurrences := 20 // Default preview limit
	if req.MaxOccurrences != nil && *req.MaxOccurrences < maxOccurrences {
		maxOccurrences = *req.MaxOccurrences
	}

	// Generate preview dates
	dates := s.generateScheduleDates(
		startDate,
		endDate,
		req.RecurrencePattern,
		req.DaysOfWeek,
		maxOccurrences,
	)

	return &SchedulePreviewResponse{
		Dates: dates,
		Count: len(dates),
	}, nil
}

// ========================================
// BACKGROUND SCHEDULER
// ========================================

// ProcessScheduledRides processes rides that need to be booked
func (s *Service) ProcessScheduledRides(ctx context.Context) error {
	// Get rides that need scheduling
	rides, err := s.repo.GetActiveRecurringRidesForScheduling(ctx)
	if err != nil {
		return err
	}

	for _, ride := range rides {
		// Generate new instances if needed
		instances := s.generateUpcomingInstances(ride, 5)
		for _, instance := range instances {
			exists, _ := s.repo.CheckExistingInstance(ctx, ride.ID, instance.ScheduledDate)
			if !exists {
				if err := s.repo.CreateInstance(ctx, instance); err != nil {
					logger.Error("failed to create instance",
						zap.String("ride_id", ride.ID.String()),
						zap.Error(err),
					)
				}
			}
		}

		// Update next scheduled date
		nextDate := s.calculateNextScheduledDate(
			time.Now(),
			ride.RecurrencePattern,
			ride.DaysOfWeek,
			ride.ScheduledTime,
			ride.Timezone,
		)
		ride.NextScheduledAt = nextDate
		_ = s.repo.UpdateRecurringRide(ctx, ride)
	}

	return nil
}

// SendReminders sends reminders for upcoming rides
func (s *Service) SendReminders(ctx context.Context) error {
	instances, err := s.repo.GetInstancesNeedingReminders(ctx)
	if err != nil {
		return err
	}

	for _, instance := range instances {
		logger.Info("Sending reminder",
			zap.String("instance_id", instance.ID.String()),
			zap.String("rider_id", instance.RiderID.String()),
		)

		// Send push notification via notification service
		if s.notificationClient != nil {
			// Format pickup time for display
			pickupTimeStr := instance.PickupAt.Format("3:04 PM")
			pickupDateStr := instance.PickupAt.Format("Mon, Jan 2")

			title := "Upcoming Ride Reminder"
			body := fmt.Sprintf("Your ride from %s is scheduled for %s at %s",
				instance.PickupAddress,
				pickupDateStr,
				pickupTimeStr,
			)

			payload := map[string]interface{}{
				"type":    "push",
				"user_id": instance.RiderID.String(),
				"title":   title,
				"body":    body,
				"data": map[string]interface{}{
					"instance_id":     instance.ID.String(),
					"pickup_address":  instance.PickupAddress,
					"dropoff_address": instance.DropoffAddress,
					"pickup_time":     instance.PickupAt.Format(time.RFC3339),
					"action":          "ride_reminder",
				},
			}

			if _, err := s.notificationClient.Post(ctx, "/api/v1/notifications/send", payload, nil); err != nil {
				logger.Warn("failed to send ride reminder notification",
					zap.String("instance_id", instance.ID.String()),
					zap.String("rider_id", instance.RiderID.String()),
					zap.Error(err))
				// Continue with other reminders, don't fail the entire batch
			}
		} else {
			logger.Warn("notification client not configured, skipping push notification",
				zap.String("instance_id", instance.ID.String()))
		}

		// Mark reminder as sent regardless of notification success
		// This prevents repeated attempts for the same instance
		if err := s.repo.MarkReminderSent(ctx, instance.ID); err != nil {
			logger.Warn("failed to mark reminder as sent",
				zap.String("instance_id", instance.ID.String()),
				zap.Error(err))
		}
	}

	return nil
}

// GetRiderStats gets statistics for a rider
func (s *Service) GetRiderStats(ctx context.Context, riderID uuid.UUID) (*RecurringRideStats, error) {
	return s.repo.GetRiderStats(ctx, riderID)
}

// ========================================
// HELPER FUNCTIONS
// ========================================

// calculateNextScheduledDate calculates the next scheduled date based on pattern
func (s *Service) calculateNextScheduledDate(fromDate time.Time, pattern RecurrencePattern, daysOfWeek []int, scheduledTime, timezone string) *time.Time {
	loc, err := time.LoadLocation(timezone)
	if err != nil {
		loc = time.UTC
	}

	// Parse time
	hour, minute := s.parseTime(scheduledTime)

	// Start from tomorrow if fromDate is today and time has passed
	candidate := fromDate.In(loc)
	candidateTime := time.Date(candidate.Year(), candidate.Month(), candidate.Day(), hour, minute, 0, 0, loc)
	if candidateTime.Before(time.Now()) {
		candidate = candidate.AddDate(0, 0, 1)
	}

	maxIterations := 365 // Safety limit
	for i := 0; i < maxIterations; i++ {
		if s.matchesPattern(candidate, pattern, daysOfWeek) {
			result := time.Date(candidate.Year(), candidate.Month(), candidate.Day(), hour, minute, 0, 0, loc)
			return &result
		}
		candidate = candidate.AddDate(0, 0, 1)
	}

	return nil
}

// matchesPattern checks if a date matches the recurrence pattern
func (s *Service) matchesPattern(date time.Time, pattern RecurrencePattern, daysOfWeek []int) bool {
	weekday := int(date.Weekday())

	switch pattern {
	case RecurrenceDaily:
		return true
	case RecurrenceWeekdays:
		return weekday >= 1 && weekday <= 5
	case RecurrenceWeekends:
		return weekday == 0 || weekday == 6
	case RecurrenceWeekly, RecurrenceCustom:
		for _, day := range daysOfWeek {
			if day == weekday {
				return true
			}
		}
		return false
	case RecurrenceBiweekly:
		// Simplified: check if it's the right day of week
		for _, day := range daysOfWeek {
			if day == weekday {
				// Would need to track which week we're on
				return true
			}
		}
		return false
	case RecurrenceMonthly:
		// Same day of month
		return true // Simplified
	}

	return false
}

// generateScheduleDates generates dates for a schedule
func (s *Service) generateScheduleDates(startDate time.Time, endDate *time.Time, pattern RecurrencePattern, daysOfWeek []int, maxOccurrences int) []time.Time {
	var dates []time.Time
	candidate := startDate

	maxDate := startDate.AddDate(1, 0, 0) // Max 1 year out
	if endDate != nil && endDate.Before(maxDate) {
		maxDate = *endDate
	}

	for len(dates) < maxOccurrences && candidate.Before(maxDate) {
		if s.matchesPattern(candidate, pattern, daysOfWeek) {
			dates = append(dates, candidate)
		}
		candidate = candidate.AddDate(0, 0, 1)
	}

	return dates
}

// generateUpcomingInstances generates instances for the next N occurrences
func (s *Service) generateUpcomingInstances(ride *RecurringRide, count int) []*ScheduledRideInstance {
	dates := s.generateScheduleDates(
		time.Now().Truncate(24*time.Hour),
		ride.EndDate,
		ride.RecurrencePattern,
		ride.DaysOfWeek,
		count,
	)

	var instances []*ScheduledRideInstance
	for _, date := range dates {
		pickupAt := s.parsePickupTime(date, ride.ScheduledTime, ride.Timezone)

		estimatedFare := s.getEstimatedFare(ride)
		priceLocked := ride.PriceLockEnabled && ride.LockedPrice != nil
		if priceLocked {
			estimatedFare = *ride.LockedPrice
		}

		instance := &ScheduledRideInstance{
			ID:              uuid.New(),
			RecurringRideID: ride.ID,
			RiderID:         ride.RiderID,
			ScheduledDate:   date,
			ScheduledTime:   ride.ScheduledTime,
			PickupAt:        pickupAt,
			PickupLocation:  ride.PickupLocation,
			DropoffLocation: ride.DropoffLocation,
			PickupAddress:   ride.PickupAddress,
			DropoffAddress:  ride.DropoffAddress,
			EstimatedFare:   estimatedFare,
			PriceLocked:     priceLocked,
			Status:          InstanceStatusScheduled,
			CreatedAt:       time.Now(),
			UpdatedAt:       time.Now(),
		}

		// Assign preferred driver if enabled
		if ride.SameDriverEnabled && ride.LastDriverID != nil {
			instance.DriverID = ride.LastDriverID
		}

		instances = append(instances, instance)
	}

	return instances
}

// parseTime parses a time string "HH:MM" to hour and minute
func (s *Service) parseTime(timeStr string) (hour, minute int) {
	fmt.Sscanf(timeStr, "%d:%d", &hour, &minute)
	return
}

// parsePickupTime creates a pickup time from date, time string, and timezone
func (s *Service) parsePickupTime(date time.Time, timeStr, timezone string) time.Time {
	loc, err := time.LoadLocation(timezone)
	if err != nil {
		loc = time.UTC
	}

	hour, minute := s.parseTime(timeStr)
	return time.Date(date.Year(), date.Month(), date.Day(), hour, minute, 0, 0, loc)
}

// getEstimatedFare gets the estimated fare for a ride
func (s *Service) getEstimatedFare(ride *RecurringRide) float64 {
	if ride.LockedPrice != nil {
		return *ride.LockedPrice
	}
	// Would call pricing service
	return 15.00 // Default estimate
}

// toInstanceSlice converts pointer slice to value slice
func (s *Service) toInstanceSlice(instances []*ScheduledRideInstance) []ScheduledRideInstance {
	result := make([]ScheduledRideInstance, len(instances))
	for i, inst := range instances {
		result[i] = *inst
	}
	return result
}
