package support

import (
	"context"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/database"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Repository struct {
	db *database.DBPool
}

func NewRepository(db *database.DBPool) *Repository {
	return &Repository{db: db}
}

// ========================================
// TICKETS
// ========================================

// CreateTicket creates a new support ticket
func (r *Repository) CreateTicket(ctx context.Context, ticket *Ticket) error {
	return r.db.Primary.WithContext(ctx).Create(ticket).Error
}

// GetTicketByID retrieves a ticket by ID
func (r *Repository) GetTicketByID(ctx context.Context, id uuid.UUID) (*Ticket, error) {
	var ticket Ticket
	err := r.db.Primary.WithContext(ctx).First(&ticket, "id = ?", id).Error
	if err != nil {
		return nil, err
	}
	return &ticket, nil
}

// GetUserTickets returns tickets for a user
func (r *Repository) GetUserTickets(ctx context.Context, userID uuid.UUID, status *TicketStatus, limit, offset int) ([]TicketSummary, int, error) {
	var total int64
	query := r.db.Primary.WithContext(ctx).Table("support_tickets t").
		Select(`
			t.id, t.ticket_number, t.category, t.priority, t.status,
			t.subject, t.created_at, t.updated_at,
			(SELECT COUNT(*) FROM support_ticket_messages WHERE ticket_id = t.id AND is_internal = false) as message_count,
			(SELECT message FROM support_ticket_messages WHERE ticket_id = t.id AND is_internal = false ORDER BY created_at DESC LIMIT 1) as last_message
		`).
		Where("t.user_id = ?", userID)

	if status != nil {
		query = query.Where("t.status = ?", *status)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var tickets []TicketSummary
	err := query.Order("t.updated_at DESC").Limit(limit).Offset(offset).Scan(&tickets).Error
	if err != nil {
		return nil, 0, err
	}

	return tickets, int(total), nil
}

// UpdateTicket updates ticket fields
func (r *Repository) UpdateTicket(ctx context.Context, id uuid.UUID, status *TicketStatus, priority *TicketPriority, assignedTo *uuid.UUID, tags []string) error {
	updates := map[string]interface{}{
		"updated_at": time.Now(),
	}

	if status != nil {
		updates["status"] = *status
		if *status == TicketStatusResolved {
			updates["resolved_at"] = time.Now()
		}
		if *status == TicketStatusClosed {
			updates["closed_at"] = time.Now()
		}
	}

	if priority != nil {
		updates["priority"] = *priority
	}

	if assignedTo != nil {
		updates["assigned_to"] = *assignedTo
	}

	if tags != nil {
		updates["tags"] = tags
	}

	return r.db.Primary.WithContext(ctx).Model(&Ticket{}).Where("id = ?", id).Updates(updates).Error
}

// ========================================
// MESSAGES
// ========================================

// CreateMessage creates a new message in a ticket
func (r *Repository) CreateMessage(ctx context.Context, msg *TicketMessage) error {
	return r.db.Primary.WithContext(ctx).Create(msg).Error
}

// GetMessagesByTicket returns messages for a ticket
func (r *Repository) GetMessagesByTicket(ctx context.Context, ticketID uuid.UUID, includeInternal bool) ([]TicketMessage, error) {
	var messages []TicketMessage
	query := r.db.Primary.WithContext(ctx).Where("ticket_id = ?", ticketID)

	if !includeInternal {
		query = query.Where("is_internal = ?", false)
	}

	err := query.Order("created_at ASC").Find(&messages).Error
	return messages, err
}

// ========================================
// FAQ ARTICLES
// ========================================

// GetFAQArticles returns active FAQ articles
func (r *Repository) GetFAQArticles(ctx context.Context, category *string) ([]FAQArticle, error) {
	var articles []FAQArticle
	query := r.db.Primary.WithContext(ctx).Where("is_active = ?", true)

	if category != nil {
		query = query.Where("category = ?", *category)
	}

	err := query.Order("sort_order ASC").Find(&articles).Error
	return articles, err
}

// GetFAQArticleByID retrieves a single FAQ article
func (r *Repository) GetFAQArticleByID(ctx context.Context, id uuid.UUID) (*FAQArticle, error) {
	var article FAQArticle
	err := r.db.Primary.WithContext(ctx).First(&article, "id = ?", id).Error
	if err != nil {
		return nil, err
	}
	return &article, nil
}

// IncrementFAQViewCount increments the view count of an FAQ article
func (r *Repository) IncrementFAQViewCount(ctx context.Context, id uuid.UUID) error {
	return r.db.Primary.WithContext(ctx).Model(&FAQArticle{}).
		Where("id = ?", id).
		Update("view_count", gorm.Expr("view_count + 1")).Error
}

// ========================================
// ADMIN - TICKET LISTING & STATS
// ========================================

// GetAllTickets returns tickets for admin with filters
func (r *Repository) GetAllTickets(ctx context.Context, status *TicketStatus, priority *TicketPriority, category *TicketCategory, limit, offset int) ([]TicketSummary, int, error) {
	var total int64
	query := r.db.Primary.WithContext(ctx).Table("support_tickets t").
		Select(`
			t.id, t.ticket_number, t.category, t.priority, t.status,
			t.subject, t.created_at, t.updated_at,
			(SELECT COUNT(*) FROM support_ticket_messages WHERE ticket_id = t.id) as message_count,
			(SELECT message FROM support_ticket_messages WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1) as last_message
		`)

	if status != nil {
		query = query.Where("t.status = ?", *status)
	}
	if priority != nil {
		query = query.Where("t.priority = ?", *priority)
	}
	if category != nil {
		query = query.Where("t.category = ?", *category)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var tickets []TicketSummary
	err := query.Order("t.updated_at DESC").Limit(limit).Offset(offset).Scan(&tickets).Error
	return tickets, int(total), err
}

// GetTicketStats returns aggregate ticket statistics
func (r *Repository) GetTicketStats(ctx context.Context) (*TicketStats, error) {
	stats := &TicketStats{}

	err := r.db.Primary.WithContext(ctx).Table("support_tickets").
		Select(`
			COUNT(*) FILTER (WHERE status = 'open') as total_open,
			COUNT(*) FILTER (WHERE status = 'in_progress') as total_in_progress,
			COUNT(*) FILTER (WHERE status = 'waiting_on_user') as total_waiting,
			COUNT(*) FILTER (WHERE status = 'resolved') as total_resolved,
			COUNT(*) FILTER (WHERE status = 'escalated') as total_escalated,
			COALESCE(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 60) FILTER (WHERE resolved_at IS NOT NULL), 0) as avg_resolution_min
		`).
		Scan(stats).Error

	if err != nil {
		return nil, err
	}

	// By category
	type catCount struct {
		Category string
		Count    int
	}
	var catCounts []catCount
	r.db.Primary.WithContext(ctx).Table("support_tickets").
		Select("category, COUNT(*) as count").
		Where("status NOT IN (?)", []TicketStatus{TicketStatusResolved, TicketStatusClosed}).
		Group("category").
		Scan(&catCounts)

	stats.ByCategory = make(map[string]int)
	for _, cc := range catCounts {
		stats.ByCategory[cc.Category] = cc.Count
	}

	// By priority
	type priCount struct {
		Priority string
		Count    int
	}
	var priCounts []priCount
	r.db.Primary.WithContext(ctx).Table("support_tickets").
		Select("priority, COUNT(*) as count").
		Where("status NOT IN (?)", []TicketStatus{TicketStatusResolved, TicketStatusClosed}).
		Group("priority").
		Scan(&priCounts)

	stats.ByPriority = make(map[string]int)
	for _, pc := range priCounts {
		stats.ByPriority[pc.Priority] = pc.Count
	}

	return stats, nil
}
