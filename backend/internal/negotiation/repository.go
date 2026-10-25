package negotiation

import (
	"context"
	"fmt"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/database"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Repository handles database operations for negotiation
type Repository struct {
	db *database.DBPool
}

// NewRepository creates a new negotiation repository
func NewRepository(db *database.DBPool) *Repository {
	return &Repository{db: db}
}

// CreateSession creates a new negotiation session
func (r *Repository) CreateSession(ctx context.Context, session *Session) error {
	if session.ID == uuid.Nil {
		session.ID = uuid.New()
	}
	return r.db.Primary.WithContext(ctx).Create(session).Error
}

// GetSessionByID retrieves a session by ID
func (r *Repository) GetSessionByID(ctx context.Context, id uuid.UUID) (*Session, error) {
	var session Session
	err := r.db.Primary.WithContext(ctx).First(&session, "id = ?", id).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get session: %w", err)
	}
	return &session, nil
}

// GetActiveSessionByRider retrieves an active session for a rider
func (r *Repository) GetActiveSessionByRider(ctx context.Context, riderID uuid.UUID) (*Session, error) {
	var session Session
	err := r.db.Primary.WithContext(ctx).
		Where("rider_id = ? AND status = ? AND expires_at > ?", riderID, SessionStatusActive, time.Now()).
		Order("created_at DESC").
		First(&session).Error

	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to get active session: %w", err)
	}

	return &session, nil
}

// UpdateSessionStatus updates a session's status
func (r *Repository) UpdateSessionStatus(ctx context.Context, id uuid.UUID, status SessionStatus) error {
	result := r.db.Primary.WithContext(ctx).Model(&Session{}).
		Where("id = ? AND status = ?", id, SessionStatusActive).
		Update("status", status)

	if result.Error != nil {
		return fmt.Errorf("failed to update session status: %w", result.Error)
	}

	return nil
}

// AcceptOffer atomically accepts an offer and updates the session
func (r *Repository) AcceptOffer(ctx context.Context, sessionID, offerID uuid.UUID) error {
	return r.db.Primary.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		now := time.Now()

		// Get and validate the offer
		var offer Offer
		if err := tx.Where("id = ? AND session_id = ? AND status = ?", offerID, sessionID, OfferStatusPending).First(&offer).Error; err != nil {
			return fmt.Errorf("offer not found or not pending: %w", err)
		}

		// Update the session
		result := tx.Model(&Session{}).
			Where("id = ? AND status = ?", sessionID, SessionStatusActive).
			Updates(map[string]interface{}{
				"status":             SessionStatusAccepted,
				"accepted_offer_id":  offerID,
				"accepted_driver_id": offer.DriverID,
				"accepted_price":     offer.OfferedPrice,
				"accepted_at":        now,
			})

		if result.Error != nil {
			return fmt.Errorf("failed to update session: %w", result.Error)
		}
		if result.RowsAffected == 0 {
			return fmt.Errorf("session is no longer active")
		}

		// Update the accepted offer
		if err := tx.Model(&offer).Updates(map[string]interface{}{
			"status":      OfferStatusAccepted,
			"accepted_at": now,
		}).Error; err != nil {
			return fmt.Errorf("failed to update offer: %w", err)
		}

		// Expire all other pending offers in this session
		if err := tx.Model(&Offer{}).
			Where("session_id = ? AND id != ? AND status = ?", sessionID, offerID, OfferStatusPending).
			Updates(map[string]interface{}{
				"status":     OfferStatusExpired,
				"expired_at": now,
			}).Error; err != nil {
			return fmt.Errorf("failed to expire other offers: %w", err)
		}

		return nil
	})
}

// CreateOffer creates a new offer
func (r *Repository) CreateOffer(ctx context.Context, offer *Offer) error {
	return r.db.Primary.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// First, supersede any pending offers from this driver in this session
		if err := tx.Model(&Offer{}).
			Where("session_id = ? AND driver_id = ? AND status = ?", offer.SessionID, offer.DriverID, OfferStatusPending).
			Update("status", OfferStatusSuperseded).Error; err != nil {
			return fmt.Errorf("failed to supersede old offers: %w", err)
		}

		if offer.ID == uuid.Nil {
			offer.ID = uuid.New()
		}

		return tx.Create(offer).Error
	})
}

// GetOfferByID retrieves an offer by ID
func (r *Repository) GetOfferByID(ctx context.Context, id uuid.UUID) (*Offer, error) {
	var offer Offer
	err := r.db.Primary.WithContext(ctx).First(&offer, "id = ?", id).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get offer: %w", err)
	}
	return &offer, nil
}

// GetOffersBySession retrieves all offers for a session
func (r *Repository) GetOffersBySession(ctx context.Context, sessionID uuid.UUID) ([]*Offer, error) {
	var offers []*Offer
	err := r.db.Primary.WithContext(ctx).
		Where("session_id = ?", sessionID).
		Order("created_at DESC").
		Find(&offers).Error

	if err != nil {
		return nil, fmt.Errorf("failed to get offers: %w", err)
	}

	return offers, nil
}

// GetSettings retrieves negotiation settings for a location
func (r *Repository) GetSettings(ctx context.Context, countryID, regionID, cityID *uuid.UUID) (*Settings, error) {
	var settings Settings
	err := r.db.Primary.WithContext(ctx).
		Where("city_id = ? OR (city_id IS NULL AND region_id = ?) OR (city_id IS NULL AND region_id IS NULL AND country_id = ?) OR (city_id IS NULL AND region_id IS NULL AND country_id IS NULL)", cityID, regionID, countryID).
		Order(`
			CASE
				WHEN city_id IS NOT NULL THEN 3
				WHEN region_id IS NOT NULL THEN 2
				WHEN country_id IS NOT NULL THEN 1
				ELSE 0
			END DESC
		`).
		First(&settings).Error

	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return &DefaultSettings, nil
		}
		return nil, fmt.Errorf("failed to get settings: %w", err)
	}

	return &settings, nil
}

// CountDriverActiveOffers counts active offers by a driver
func (r *Repository) CountDriverActiveOffers(ctx context.Context, driverID uuid.UUID) (int, error) {
	var count int64
	err := r.db.Primary.WithContext(ctx).Table("negotiation_offers").
		Joins("JOIN negotiation_sessions ON negotiation_offers.session_id = negotiation_sessions.id").
		Where("negotiation_offers.driver_id = ? AND negotiation_offers.status = ? AND negotiation_sessions.status = ?", driverID, OfferStatusPending, SessionStatusActive).
		Count(&count).Error

	if err != nil {
		return 0, fmt.Errorf("failed to count active offers: %w", err)
	}

	return int(count), nil
}

// ExpireSession marks a session as expired
func (r *Repository) ExpireSession(ctx context.Context, sessionID uuid.UUID) error {
	return r.db.Primary.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		now := time.Now()

		// Update session
		if err := tx.Model(&Session{}).
			Where("id = ? AND status = ?", sessionID, SessionStatusActive).
			Update("status", SessionStatusExpired).Error; err != nil {
			return fmt.Errorf("failed to expire session: %w", err)
		}

		// Expire all pending offers
		if err := tx.Model(&Offer{}).
			Where("session_id = ? AND status = ?", sessionID, OfferStatusPending).
			Updates(map[string]interface{}{
				"status":     OfferStatusExpired,
				"expired_at": now,
			}).Error; err != nil {
			return fmt.Errorf("failed to expire offers: %w", err)
		}

		return nil
	})
}

// GetExpiredSessions retrieves sessions that have expired but not yet marked
func (r *Repository) GetExpiredSessions(ctx context.Context) ([]*Session, error) {
	var sessions []*Session
	err := r.db.Primary.WithContext(ctx).
		Where("status = ? AND expires_at <= ?", SessionStatusActive, time.Now()).
		Limit(100).
		Find(&sessions).Error

	if err != nil {
		return nil, fmt.Errorf("failed to get expired sessions: %w", err)
	}

	return sessions, nil
}
