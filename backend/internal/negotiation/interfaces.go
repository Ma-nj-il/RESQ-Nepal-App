package negotiation

import (
	"context"

	"github.com/bikky-kc013/medi-ambulance/internal/geography"
	"github.com/bikky-kc013/medi-ambulance/internal/pricing"
	"github.com/google/uuid"
)

type RepositoryInterface interface {
	CreateSession(ctx context.Context, session *Session) error
	GetSessionByID(ctx context.Context, id uuid.UUID) (*Session, error)
	GetActiveSessionByRider(ctx context.Context, riderID uuid.UUID) (*Session, error)
	UpdateSessionStatus(ctx context.Context, id uuid.UUID, status SessionStatus) error
	AcceptOffer(ctx context.Context, sessionID, offerID uuid.UUID) error
	CreateOffer(ctx context.Context, offer *Offer) error
	GetOfferByID(ctx context.Context, id uuid.UUID) (*Offer, error)
	GetOffersBySession(ctx context.Context, sessionID uuid.UUID) ([]*Offer, error)
	GetSettings(ctx context.Context, countryID, regionID, cityID *uuid.UUID) (*Settings, error)
	CountDriverActiveOffers(ctx context.Context, driverID uuid.UUID) (int, error)
	ExpireSession(ctx context.Context, sessionID uuid.UUID) error
	GetExpiredSessions(ctx context.Context) ([]*Session, error)
}

type PricingServiceInterface interface {
	GetEstimate(ctx context.Context, req pricing.EstimateRequest) (*pricing.EstimateResponse, error)
}

type GeographyServiceInterface interface {
	ResolveLocation(ctx context.Context, latitude, longitude float64) (*geography.ResolvedLocation, error)
}
