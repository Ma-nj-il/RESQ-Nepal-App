package disputes

import (
	"context"
	"crypto/rand"
	"fmt"
	"math/big"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/common"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

const (
	maxDisputeWindowDays = 30
	maxOpenDisputes      = 5
)

type Service struct {
	repo RepositoryInterface
}

func NewService(repo RepositoryInterface) *Service {
	if repo == nil {
		panic("disputes: repository cannot be nil")
	}
	return &Service{repo: repo}
}

func (s *Service) CreateDispute(ctx context.Context, userID uuid.UUID, req *CreateDisputeRequest) (*Dispute, error) {
	rc, err := s.repo.GetRideContext(ctx, req.RideID)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, common.NewNotFoundError("ride not found", nil)
		}
		return nil, err
	}

	if rc.CompletedAt == nil {
		return nil, common.NewBadRequestError("can only dispute completed rides", nil)
	}

	if time.Since(*rc.CompletedAt).Hours() > float64(maxDisputeWindowDays*24) {
		return nil, common.NewBadRequestError(
			fmt.Sprintf("disputes must be filed within %d days of ride completion", maxDisputeWindowDays), nil,
		)
	}

	fare := rc.EstimatedFare
	if rc.FinalFare != nil {
		fare = *rc.FinalFare
	}
	if req.DisputedAmount > fare {
		return nil, common.NewBadRequestError("disputed amount cannot exceed the ride fare", nil)
	}

	existing, err := s.repo.GetDisputeByRideAndUser(ctx, req.RideID, userID)
	if err != nil && err != gorm.ErrRecordNotFound {
		return nil, err
	}
	if existing != nil {
		return nil, common.NewConflictError("you already have an active dispute for this ride")
	}

	evidence := req.Evidence
	if evidence == nil {
		evidence = []string{}
	}

	now := time.Now()
	dispute := &Dispute{
		ID:             uuid.New(),
		RideID:         req.RideID,
		UserID:         userID,
		DisputeNumber:  generateDisputeNumber(),
		Reason:         req.Reason,
		Description:    req.Description,
		Status:         DisputeStatusPending,
		OriginalFare:   fare,
		DisputedAmount: req.DisputedAmount,
		Evidence:       evidence,
		CreatedAt:      now,
		UpdatedAt:      now,
	}

	if err := s.repo.CreateDispute(ctx, dispute); err != nil {
		return nil, fmt.Errorf("create dispute: %w", err)
	}

	comment := &DisputeComment{
		ID:         uuid.New(),
		DisputeID:  dispute.ID,
		UserID:     userID,
		UserRole:   "user",
		Comment:    req.Description,
		IsInternal: false,
		CreatedAt:  now,
	}
	s.repo.CreateComment(ctx, comment)

	return dispute, nil
}

func (s *Service) GetMyDisputes(ctx context.Context, userID uuid.UUID, status *DisputeStatus, limit, offset int) ([]DisputeSummary, int, error) {
	if limit < 1 || limit > 50 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	return s.repo.GetUserDisputes(ctx, userID, status, limit, offset)
}

func (s *Service) GetDisputeDetail(ctx context.Context, disputeID, userID uuid.UUID) (*DisputeDetailResponse, error) {
	dispute, err := s.repo.GetDisputeByID(ctx, disputeID)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, common.NewNotFoundError("dispute not found", nil)
		}
		return nil, err
	}

	if dispute.UserID != userID {
		return nil, common.NewForbiddenError("not authorized to view this dispute")
	}

	rc, _ := s.repo.GetRideContext(ctx, dispute.RideID)
	comments, _ := s.repo.GetCommentsByDispute(ctx, disputeID, false)

	return &DisputeDetailResponse{
		Dispute:     dispute,
		RideContext: rc,
		Comments:    comments,
	}, nil
}

func (s *Service) AddComment(ctx context.Context, disputeID, userID uuid.UUID, req *AddCommentRequest) (*DisputeComment, error) {
	dispute, err := s.repo.GetDisputeByID(ctx, disputeID)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, common.NewNotFoundError("dispute not found", nil)
		}
		return nil, err
	}

	if dispute.UserID != userID {
		return nil, common.NewForbiddenError("not authorized to comment on this dispute")
	}

	if dispute.Status == DisputeStatusClosed || dispute.Status == DisputeStatusRejected {
		return nil, common.NewBadRequestError("cannot comment on a closed or rejected dispute", nil)
	}

	now := time.Now()
	comment := &DisputeComment{
		ID:         uuid.New(),
		DisputeID:  disputeID,
		UserID:     userID,
		UserRole:   "user",
		Comment:    req.Comment,
		IsInternal: false,
		CreatedAt:  now,
	}

	if err := s.repo.CreateComment(ctx, comment); err != nil {
		return nil, fmt.Errorf("create comment: %w", err)
	}

	return comment, nil
}

func (s *Service) GetDisputeReasons() *DisputeReasonsResponse {
	return &DisputeReasonsResponse{
		Reasons: []DisputeReasonOption{
			{Code: ReasonWrongRoute, Label: "Wrong route taken", Description: "The driver took a different route than expected"},
			{Code: ReasonOvercharged, Label: "Overcharged", Description: "The fare was higher than the estimate"},
			{Code: ReasonTripNotTaken, Label: "Trip not taken", Description: "I was charged for a trip I didn't take"},
			{Code: ReasonDriverDetour, Label: "Driver took a detour", Description: "The driver intentionally took a longer route"},
			{Code: ReasonWrongFare, Label: "Wrong fare calculation", Description: "The fare doesn't match the distance/time"},
			{Code: ReasonSurgeUnfair, Label: "Unfair surge pricing", Description: "The surge multiplier was incorrect"},
			{Code: ReasonWaitTimeWrong, Label: "Wrong wait time charge", Description: "I was charged for wait time incorrectly"},
			{Code: ReasonCancelFeeWrong, Label: "Wrong cancellation fee", Description: "The cancellation fee was incorrect"},
			{Code: ReasonDuplicateCharge, Label: "Duplicate charge", Description: "I was charged twice for the same ride"},
			{Code: ReasonOther, Label: "Other", Description: "Another reason not listed above"},
		},
	}
}

func (s *Service) AdminGetDisputes(ctx context.Context, status *DisputeStatus, reason *DisputeReason, limit, offset int) ([]DisputeSummary, int, error) {
	if limit < 1 || limit > 100 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	return s.repo.GetAllDisputes(ctx, status, reason, limit, offset)
}

func (s *Service) AdminGetDisputeDetail(ctx context.Context, disputeID uuid.UUID) (*DisputeDetailResponse, error) {
	dispute, err := s.repo.GetDisputeByID(ctx, disputeID)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, common.NewNotFoundError("dispute not found", nil)
		}
		return nil, err
	}

	rc, _ := s.repo.GetRideContext(ctx, dispute.RideID)
	comments, _ := s.repo.GetCommentsByDispute(ctx, disputeID, true)

	return &DisputeDetailResponse{
		Dispute:     dispute,
		RideContext: rc,
		Comments:    comments,
	}, nil
}

func (s *Service) AdminResolveDispute(ctx context.Context, disputeID, adminID uuid.UUID, req *ResolveDisputeRequest) error {
	dispute, err := s.repo.GetDisputeByID(ctx, disputeID)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return common.NewNotFoundError("dispute not found", nil)
		}
		return err
	}

	if dispute.Status == DisputeStatusClosed || dispute.Status == DisputeStatusApproved || dispute.Status == DisputeStatusRejected {
		return common.NewBadRequestError("dispute already resolved", nil)
	}

	var status DisputeStatus
	switch req.ResolutionType {
	case ResolutionFullRefund:
		status = DisputeStatusApproved
		amount := dispute.OriginalFare
		req.RefundAmount = &amount
	case ResolutionPartialRefund:
		status = DisputeStatusPartial
		if req.RefundAmount == nil || *req.RefundAmount <= 0 {
			return common.NewBadRequestError("partial refund requires a positive refund amount", nil)
		}
		if *req.RefundAmount > dispute.OriginalFare {
			return common.NewBadRequestError("refund amount cannot exceed original fare", nil)
		}
	case ResolutionCredits:
		status = DisputeStatusApproved
	case ResolutionNoAction:
		status = DisputeStatusRejected
	case ResolutionFareAdjust:
		status = DisputeStatusApproved
		if req.RefundAmount == nil {
			return common.NewBadRequestError("fare adjustment requires an amount", nil)
		}
	default:
		return common.NewBadRequestError("invalid resolution type", nil)
	}

	if err := s.repo.ResolveDispute(ctx, disputeID, status, req.ResolutionType, req.RefundAmount, req.Note, adminID); err != nil {
		return fmt.Errorf("resolve dispute: %w", err)
	}

	comment := &DisputeComment{
		ID:         uuid.New(),
		DisputeID:  disputeID,
		UserID:     adminID,
		UserRole:   "admin",
		Comment:    fmt.Sprintf("Dispute resolved: %s - %s", req.ResolutionType, req.Note),
		IsInternal: false,
		CreatedAt:  time.Now(),
	}
	s.repo.CreateComment(ctx, comment)

	return nil
}

func (s *Service) AdminAddComment(ctx context.Context, disputeID, adminID uuid.UUID, comment string, isInternal bool) (*DisputeComment, error) {
	_, err := s.repo.GetDisputeByID(ctx, disputeID)	
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, common.NewNotFoundError("dispute not found", nil)
		}
		return nil, err
	}

	c := &DisputeComment{
		ID:         uuid.New(),
		DisputeID:  disputeID,
		UserID:     adminID,
		UserRole:   "admin",
		Comment:    comment,
		IsInternal: isInternal,
		CreatedAt:  time.Now(),
	}

	if err := s.repo.CreateComment(ctx, c); err != nil {
		return nil, fmt.Errorf("create admin comment: %w", err)
	}

	s.repo.UpdateDisputeStatus(ctx, disputeID, DisputeStatusReviewing)

	return c, nil
}

func (s *Service) AdminGetStats(ctx context.Context, from, to time.Time) (*DisputeStats, error) {
	return s.repo.GetDisputeStats(ctx, from, to)
}

func generateDisputeNumber() string {
	n, _ := rand.Int(rand.Reader, big.NewInt(999999))
	return fmt.Sprintf("DSP-%06d", n.Int64())
}
