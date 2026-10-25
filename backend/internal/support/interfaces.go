package support

import (
	"context"

	"github.com/google/uuid"
)

// RepositoryInterface defines all public methods of the Repository
type RepositoryInterface interface {
	// Tickets
	CreateTicket(ctx context.Context, ticket *Ticket) error
	GetTicketByID(ctx context.Context, id uuid.UUID) (*Ticket, error)
	GetUserTickets(ctx context.Context, userID uuid.UUID, status *TicketStatus, limit, offset int) ([]TicketSummary, int, error)
	GetAllTickets(ctx context.Context, status *TicketStatus, priority *TicketPriority, category *TicketCategory, limit, offset int) ([]TicketSummary, int, error)
	UpdateTicket(ctx context.Context, id uuid.UUID, status *TicketStatus, priority *TicketPriority, assignedTo *uuid.UUID, tags []string) error
	GetTicketStats(ctx context.Context) (*TicketStats, error)

	// Messages
	CreateMessage(ctx context.Context, msg *TicketMessage) error
	GetMessagesByTicket(ctx context.Context, ticketID uuid.UUID, includeInternal bool) ([]TicketMessage, error)

	// FAQ Articles
	GetFAQArticles(ctx context.Context, category *string) ([]FAQArticle, error)
	GetFAQArticleByID(ctx context.Context, id uuid.UUID) (*FAQArticle, error)
	IncrementFAQViewCount(ctx context.Context, id uuid.UUID) error
}
