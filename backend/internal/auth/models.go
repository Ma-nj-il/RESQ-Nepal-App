package auth

import (
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/models"
	"github.com/google/uuid"
)

const (
	accessTokenTTL       = 15 * time.Minute
	rememberedSessionTTL = 30 * 24 * time.Hour
	defaultSessionTTL    = 24 * time.Hour
	recoveryCodeCount    = 10
)

type ClientInfo struct {
	IPAddress string
	UserAgent string
}

type AuthSession struct {
	ID               uuid.UUID  `json:"id" gorm:"type:uuid;primaryKey"`
	UserID           uuid.UUID  `json:"-" gorm:"type:uuid;not null"`
	RefreshTokenHash string     `json:"-" gorm:"not null"`
	AuthVersion      int        `json:"-" gorm:"not null"`
	RememberMe       bool       `json:"remember_me" gorm:"not null"`
	DeviceName       *string    `json:"device_name,omitempty"`
	IPAddress        *string    `json:"ip_address,omitempty"`
	UserAgent        *string    `json:"user_agent,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
	LastUsedAt       time.Time  `json:"last_used_at"`
	ExpiresAt        time.Time  `json:"expires_at"`
	RevokedAt        *time.Time `json:"-"`
	RevocationReason *string    `json:"-"`
}

func (AuthSession) TableName() string {
	return "auth_sessions"
}

type AccountRecoveryCode struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey"`
	UserID    uuid.UUID `gorm:"type:uuid;not null"`
	CodeHash  string    `gorm:"not null"`
	CreatedAt time.Time
	UsedAt    *time.Time
}

func (AccountRecoveryCode) TableName() string {
	return "account_recovery_codes"
}

type AuditEvent struct {
	ID          uuid.UUID
	UserID      *uuid.UUID
	SessionID   *uuid.UUID
	EventType   string
	EventStatus string
	IPAddress   *string
	UserAgent   *string
	Metadata    map[string]interface{}
	CreatedAt   time.Time
}

type LoginResponse struct {
	User         *models.User    `json:"user"`
	Token        string          `json:"token"`
	AccessToken  string          `json:"access_token"`
	RefreshToken string          `json:"refresh_token"`
	TokenType    string          `json:"token_type"`
	ExpiresIn    int64           `json:"expires_in"`
	Session      SessionResponse `json:"session"`
}

type SessionResponse struct {
	ID         uuid.UUID `json:"id"`
	RememberMe bool      `json:"remember_me"`
	DeviceName *string   `json:"device_name,omitempty"`
	IPAddress  *string   `json:"ip_address,omitempty"`
	UserAgent  *string   `json:"user_agent,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
	LastUsedAt time.Time `json:"last_used_at"`
	ExpiresAt  time.Time `json:"expires_at"`
	Current    bool      `json:"current"`
}

type RefreshTokenRequest struct {
	RefreshToken string `json:"refresh_token" binding:"required"`
}

type UpdateProfileRequest struct {
	FirstName       *string `json:"first_name"`
	LastName        *string `json:"last_name"`
	PhoneNumber     *string `json:"phone_number"`
	ProfileImage    *string `json:"profile_image"`
	CurrentPassword string  `json:"current_password"`
}

type ProfileChanges struct {
	FirstName    *string
	LastName     *string
	PhoneNumber  *string
	ProfileImage *string
}

type ChangePasswordRequest struct {
	CurrentPassword string `json:"current_password" binding:"required"`
	NewPassword     string `json:"new_password" binding:"required"`
}

type CurrentPasswordRequest struct {
	CurrentPassword string `json:"current_password" binding:"required"`
}

type RecoveryCodesResponse struct {
	RecoveryCodes []string `json:"recovery_codes"`
}

type RecoveryCodeResetRequest struct {
	Email        string `json:"email" binding:"required"`
	RecoveryCode string `json:"recovery_code" binding:"required"`
	NewPassword  string `json:"new_password" binding:"required"`
}

type ReactivateAccountRequest struct {
	Email      string `json:"email" binding:"required"`
	Password   string `json:"password" binding:"required"`
	RememberMe bool   `json:"remember_me"`
	DeviceName string `json:"device_name"`
}

type MessageResponse struct {
	Message string `json:"message"`
}

func sessionResponse(session *AuthSession, currentID uuid.UUID) SessionResponse {
	return SessionResponse{
		ID:         session.ID,
		RememberMe: session.RememberMe,
		DeviceName: session.DeviceName,
		IPAddress:  session.IPAddress,
		UserAgent:  session.UserAgent,
		CreatedAt:  session.CreatedAt,
		LastUsedAt: session.LastUsedAt,
		ExpiresAt:  session.ExpiresAt,
		Current:    session.ID == currentID,
	}
}
