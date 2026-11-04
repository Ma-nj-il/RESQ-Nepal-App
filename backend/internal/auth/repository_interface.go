package auth

import (
	"context"
	"errors"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/models"
	"github.com/google/uuid"
)

var (
	ErrUserNotFound        = errors.New("auth: user not found")
	ErrDuplicateEmail      = errors.New("auth: duplicate email")
	ErrDuplicatePhone      = errors.New("auth: duplicate phone")
	ErrSessionNotFound     = errors.New("auth: session not found")
	ErrInvalidRefreshToken = errors.New("auth: invalid refresh token")
	ErrRecoveryCodeUsed    = errors.New("auth: recovery code is invalid or used")
	ErrInvalidAccountState = errors.New("auth: invalid account state")
)

type RepositoryInterface interface {
	CreateUser(ctx context.Context, user *models.User) error
	GetUserByEmail(ctx context.Context, email string) (*models.User, error)
	GetUserByPhone(ctx context.Context, phone string) (*models.User, error)
	GetUserByID(ctx context.Context, id uuid.UUID) (*models.User, error)
	UpdateProfile(ctx context.Context, userID uuid.UUID, changes ProfileChanges) (*models.User, error)

	CreateSession(ctx context.Context, session *AuthSession) error
	RotateSession(ctx context.Context, currentHash, replacementHash string, usedAt time.Time) (*AuthSession, *models.User, error)
	ValidateSession(ctx context.Context, userID, sessionID uuid.UUID, now time.Time) error
	ListSessions(ctx context.Context, userID uuid.UUID, now time.Time) ([]*AuthSession, error)
	RevokeSession(ctx context.Context, userID, sessionID uuid.UUID, reason string, now time.Time) error
	RevokeAllSessions(ctx context.Context, userID uuid.UUID, reason string, exceptSessionID *uuid.UUID, now time.Time) (int64, error)

	ChangePassword(ctx context.Context, userID, currentSessionID uuid.UUID, passwordHash string, now time.Time) error
	ReplaceRecoveryCodes(ctx context.Context, userID uuid.UUID, codes []*AccountRecoveryCode) error
	GetUnusedRecoveryCodes(ctx context.Context, userID uuid.UUID) ([]*AccountRecoveryCode, error)
	ResetPasswordWithRecoveryCode(ctx context.Context, userID, codeID uuid.UUID, passwordHash string, now time.Time) error
	DeactivateAccount(ctx context.Context, userID uuid.UUID, now time.Time) error
	ReactivateAccount(ctx context.Context, userID uuid.UUID, session *AuthSession, now time.Time) error
	DeleteAccount(ctx context.Context, userID uuid.UUID, anonymizedEmail, anonymizedPhone, invalidPasswordHash string, now time.Time) error

	CreateAuditEvent(ctx context.Context, event *AuditEvent) error
}
