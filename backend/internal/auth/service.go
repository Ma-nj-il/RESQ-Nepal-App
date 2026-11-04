package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base32"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/bikky-kc013/medi-ambulance/pkg/common"
	"github.com/bikky-kc013/medi-ambulance/pkg/jwtkeys"
	"github.com/bikky-kc013/medi-ambulance/pkg/middleware"
	"github.com/bikky-kc013/medi-ambulance/pkg/models"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"
)

const (
	errCodeEmailExists          = "AUTH_EMAIL_EXISTS"
	errCodePhoneExists          = "AUTH_PHONE_EXISTS"
	errCodeAccountDeactivated   = "AUTH_ACCOUNT_DEACTIVATED"
	errCodeAccountAlreadyActive = "AUTH_ACCOUNT_ALREADY_ACTIVE"
	errCodeInvalidSession       = "AUTH_SESSION_INVALID"
	errCodeInvalidRecoveryCode  = "AUTH_INVALID_RECOVERY_CODE"
)

var (
	nepaliMobilePattern = regexp.MustCompile(`^\+9779[678][0-9]{8}$`)
	emailPattern        = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
	recoveryCodePattern = regexp.MustCompile(`^[A-Z2-7]{16}$`)
)

type Service struct {
	repo         RepositoryInterface
	keyManager   *jwtkeys.Manager
	logger       *zap.Logger
	now          func() time.Time
	random       io.Reader
	passwordCost int
}

type signingMaterial struct {
	keyID  string
	secret []byte
}

func NewService(repo RepositoryInterface, keyManager *jwtkeys.Manager, logger *zap.Logger) *Service {
	if logger == nil {
		logger = zap.NewNop()
	}
	return &Service{
		repo:         repo,
		keyManager:   keyManager,
		logger:       logger,
		now:          time.Now,
		random:       rand.Reader,
		passwordCost: bcrypt.DefaultCost,
	}
}

func (s *Service) Register(ctx context.Context, req *models.RegisterRequest, client ClientInfo) (*models.User, error) {
	normalized, appErr := canonicalRegistration(req)
	if appErr != nil {
		s.audit(ctx, nil, nil, "register", "failure", client, map[string]interface{}{"reason": "validation"})
		return nil, appErr
	}

	existing, err := s.repo.GetUserByEmail(ctx, normalized.Email)
	if err == nil {
		s.audit(ctx, &existing.ID, nil, "register", "failure", client, map[string]interface{}{"reason": "email_exists"})
		return nil, conflictError(errCodeEmailExists, "an account with this email already exists")
	}
	if !errors.Is(err, ErrUserNotFound) {
		return nil, s.internalError("registration failed", err)
	}

	existing, err = s.repo.GetUserByPhone(ctx, normalized.PhoneNumber)
	if err == nil {
		s.audit(ctx, &existing.ID, nil, "register", "failure", client, map[string]interface{}{"reason": "phone_exists"})
		return nil, conflictError(errCodePhoneExists, "an account with this phone number already exists")
	}
	if !errors.Is(err, ErrUserNotFound) {
		return nil, s.internalError("registration failed", err)
	}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(normalized.Password), s.passwordCost)
	if err != nil {
		return nil, s.internalError("registration failed", err)
	}

	now := s.now().UTC()
	termsVersion := normalized.TermsVersion
	user := &models.User{
		ID:              uuid.New(),
		Email:           normalized.Email,
		PhoneNumber:     normalized.PhoneNumber,
		PasswordHash:    string(passwordHash),
		FirstName:       normalized.FirstName,
		LastName:        normalized.LastName,
		Role:            models.RoleRider,
		IsActive:        true,
		IsVerified:      false,
		AccountStatus:   models.AccountStatusActive,
		AuthVersion:     1,
		TermsVersion:    &termsVersion,
		TermsAcceptedAt: &now,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	if err := s.repo.CreateUser(ctx, user); err != nil {
		switch {
		case errors.Is(err, ErrDuplicateEmail):
			return nil, conflictError(errCodeEmailExists, "an account with this email already exists")
		case errors.Is(err, ErrDuplicatePhone):
			return nil, conflictError(errCodePhoneExists, "an account with this phone number already exists")
		default:
			return nil, s.internalError("registration failed", err)
		}
	}

	s.audit(ctx, &user.ID, nil, "register", "success", client, nil)
	return publicUser(user), nil
}

func (s *Service) Login(ctx context.Context, req *models.LoginRequest, client ClientInfo) (*LoginResponse, error) {
	if req == nil {
		s.audit(ctx, nil, nil, "login", "failure", client, map[string]interface{}{"reason": "invalid_credentials"})
		return nil, invalidCredentialsError()
	}
	email, err := canonicalEmail(req.Email)
	if err != nil {
		s.audit(ctx, nil, nil, "login", "failure", client, map[string]interface{}{"reason": "invalid_credentials"})
		return nil, invalidCredentialsError()
	}

	user, err := s.repo.GetUserByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, ErrUserNotFound) {
			s.audit(ctx, nil, nil, "login", "failure", client, map[string]interface{}{"reason": "invalid_credentials"})
			return nil, invalidCredentialsError()
		}
		return nil, s.internalError("login failed", err)
	}
	if user.DeletedAt != nil || user.AccountStatus == models.AccountStatusDeleted || bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)) != nil {
		s.audit(ctx, &user.ID, nil, "login", "failure", client, map[string]interface{}{"reason": "invalid_credentials"})
		return nil, invalidCredentialsError()
	}
	if user.AccountStatus == models.AccountStatusDeactivated {
		s.audit(ctx, &user.ID, nil, "login", "failure", client, map[string]interface{}{"reason": "account_deactivated"})
		return nil, common.NewErrorWithCode(http.StatusForbidden, errCodeAccountDeactivated, "account is deactivated", common.ErrForbidden)
	}
	if !accountIsActive(user) {
		s.audit(ctx, &user.ID, nil, "login", "failure", client, map[string]interface{}{"reason": "invalid_credentials"})
		return nil, invalidCredentialsError()
	}

	response, session, err := s.createLoginResponse(ctx, user, req.RememberMe, req.DeviceName, client)
	if err != nil {
		return nil, err
	}
	s.audit(ctx, &user.ID, &session.ID, "login", "success", client, nil)
	return response, nil
}

func (s *Service) Refresh(ctx context.Context, req *RefreshTokenRequest, client ClientInfo) (*LoginResponse, error) {
	if req == nil || len(req.RefreshToken) < 32 || len(req.RefreshToken) > 1024 {
		s.audit(ctx, nil, nil, "refresh", "failure", client, map[string]interface{}{"reason": "invalid_token"})
		return nil, invalidSessionError()
	}

	signer, err := s.prepareSigningKey(ctx)
	if err != nil {
		return nil, s.internalError("token refresh failed", err)
	}
	replacementToken, err := s.randomToken(32)
	if err != nil {
		return nil, s.internalError("token refresh failed", err)
	}
	now := s.now().UTC()
	session, user, err := s.repo.RotateSession(ctx, tokenHash(req.RefreshToken), tokenHash(replacementToken), now)
	if err != nil {
		if errors.Is(err, ErrInvalidRefreshToken) || errors.Is(err, ErrSessionNotFound) {
			s.audit(ctx, nil, nil, "refresh", "failure", client, map[string]interface{}{"reason": "invalid_token"})
			return nil, invalidSessionError()
		}
		return nil, s.internalError("token refresh failed", err)
	}

	accessToken, err := s.signAccessToken(user, session.ID, now, signer)
	if err != nil {
		return nil, s.internalError("token refresh failed", err)
	}
	response := loginResponse(user, session, accessToken, replacementToken)
	s.audit(ctx, &user.ID, &session.ID, "refresh", "success", client, nil)
	return response, nil
}

func (s *Service) ValidateActiveSession(ctx context.Context, userID, sessionID uuid.UUID) error {
	if userID == uuid.Nil || sessionID == uuid.Nil {
		return invalidSessionError()
	}
	if err := s.repo.ValidateSession(ctx, userID, sessionID, s.now().UTC()); err != nil {
		if errors.Is(err, ErrSessionNotFound) {
			return invalidSessionError()
		}
		return s.internalError("session validation failed", err)
	}
	return nil
}

func (s *Service) Logout(ctx context.Context, userID, sessionID uuid.UUID, client ClientInfo) error {
	now := s.now().UTC()
	if err := s.repo.RevokeSession(ctx, userID, sessionID, "logout", now); err != nil {
		if errors.Is(err, ErrSessionNotFound) {
			return invalidSessionError()
		}
		return s.internalError("logout failed", err)
	}
	s.audit(ctx, &userID, &sessionID, "logout", "success", client, nil)
	return nil
}

func (s *Service) ListSessions(ctx context.Context, userID, currentSessionID uuid.UUID) ([]SessionResponse, error) {
	sessions, err := s.repo.ListSessions(ctx, userID, s.now().UTC())
	if err != nil {
		return nil, s.internalError("failed to list sessions", err)
	}
	response := make([]SessionResponse, 0, len(sessions))
	for _, session := range sessions {
		response = append(response, sessionResponse(session, currentSessionID))
	}
	return response, nil
}

func (s *Service) RevokeSession(ctx context.Context, userID, currentSessionID, targetSessionID uuid.UUID, client ClientInfo) error {
	if err := s.repo.RevokeSession(ctx, userID, targetSessionID, "user_revoked", s.now().UTC()); err != nil {
		if errors.Is(err, ErrSessionNotFound) {
			return common.NewNotFoundError("session not found", err)
		}
		return s.internalError("failed to revoke session", err)
	}
	s.audit(ctx, &userID, &currentSessionID, "session_revoked", "success", client, map[string]interface{}{
		"revoked_session_id": targetSessionID.String(),
	})
	return nil
}

func (s *Service) RevokeAllSessions(ctx context.Context, userID, currentSessionID uuid.UUID, currentPassword string, client ClientInfo) error {
	if _, err := s.verifyCurrentPassword(ctx, userID, currentPassword); err != nil {
		s.audit(ctx, &userID, &currentSessionID, "sessions_revoked_all", "failure", client, map[string]interface{}{"reason": "invalid_password"})
		return err
	}
	count, err := s.repo.RevokeAllSessions(ctx, userID, "user_revoked_all", nil, s.now().UTC())
	if err != nil {
		return s.internalError("failed to revoke sessions", err)
	}
	s.audit(ctx, &userID, &currentSessionID, "sessions_revoked_all", "success", client, map[string]interface{}{"revoked_count": count})
	return nil
}

func (s *Service) GetProfile(ctx context.Context, userID uuid.UUID) (*models.User, error) {
	user, err := s.repo.GetUserByID(ctx, userID)
	if err != nil {
		if errors.Is(err, ErrUserNotFound) {
			return nil, common.NewNotFoundError("user not found", err)
		}
		return nil, s.internalError("failed to get profile", err)
	}
	if !accountIsActive(user) {
		return nil, invalidSessionError()
	}
	return publicUser(user), nil
}

func (s *Service) UpdateProfile(ctx context.Context, userID uuid.UUID, req *UpdateProfileRequest) (*models.User, error) {
	if req == nil {
		return nil, common.NewValidationError("at least one profile field is required")
	}
	user, err := s.repo.GetUserByID(ctx, userID)
	if err != nil {
		if errors.Is(err, ErrUserNotFound) {
			return nil, common.NewNotFoundError("user not found", err)
		}
		return nil, s.internalError("failed to update profile", err)
	}
	if !accountIsActive(user) {
		return nil, invalidSessionError()
	}

	changes := ProfileChanges{}
	if req.FirstName != nil {
		name, appErr := canonicalName(*req.FirstName, "first_name")
		if appErr != nil {
			return nil, appErr
		}
		changes.FirstName = &name
	}
	if req.LastName != nil {
		name, appErr := canonicalName(*req.LastName, "last_name")
		if appErr != nil {
			return nil, appErr
		}
		changes.LastName = &name
	}
	if req.ProfileImage != nil {
		profileImage := strings.TrimSpace(*req.ProfileImage)
		if utf8.RuneCountInString(profileImage) > 2048 {
			return nil, common.NewValidationError("profile_image must be at most 2048 characters")
		}
		changes.ProfileImage = &profileImage
	}
	if req.PhoneNumber != nil {
		phone, appErr := canonicalPhone(*req.PhoneNumber)
		if appErr != nil {
			return nil, appErr
		}
		if phone != user.PhoneNumber {
			if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.CurrentPassword)) != nil {
				return nil, currentPasswordError()
			}
			existing, lookupErr := s.repo.GetUserByPhone(ctx, phone)
			if lookupErr == nil && existing.ID != userID {
				return nil, conflictError(errCodePhoneExists, "an account with this phone number already exists")
			}
			if lookupErr != nil && !errors.Is(lookupErr, ErrUserNotFound) {
				return nil, s.internalError("failed to update profile", lookupErr)
			}
			changes.PhoneNumber = &phone
		}
	}
	if changes.FirstName == nil && changes.LastName == nil && changes.PhoneNumber == nil && changes.ProfileImage == nil {
		return nil, common.NewValidationError("at least one changed profile field is required")
	}

	updated, err := s.repo.UpdateProfile(ctx, userID, changes)
	if err != nil {
		if errors.Is(err, ErrDuplicatePhone) {
			return nil, conflictError(errCodePhoneExists, "an account with this phone number already exists")
		}
		return nil, s.internalError("failed to update profile", err)
	}
	return publicUser(updated), nil
}

func (s *Service) ChangePassword(ctx context.Context, userID, sessionID uuid.UUID, req *ChangePasswordRequest, client ClientInfo) error {
	if req == nil {
		return common.NewValidationError("password change request is required")
	}
	user, err := s.verifyCurrentPassword(ctx, userID, req.CurrentPassword)
	if err != nil {
		s.audit(ctx, &userID, &sessionID, "password_changed", "failure", client, map[string]interface{}{"reason": "invalid_password"})
		return err
	}
	if appErr := validatePassword(req.NewPassword); appErr != nil {
		return appErr
	}
	if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.NewPassword)) == nil {
		return common.NewValidationError("new_password must differ from current_password")
	}
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), s.passwordCost)
	if err != nil {
		return s.internalError("failed to change password", err)
	}
	if err := s.repo.ChangePassword(ctx, userID, sessionID, string(passwordHash), s.now().UTC()); err != nil {
		if errors.Is(err, ErrSessionNotFound) {
			return invalidSessionError()
		}
		return s.internalError("failed to change password", err)
	}
	s.audit(ctx, &userID, &sessionID, "password_changed", "success", client, nil)
	return nil
}

func (s *Service) RegenerateRecoveryCodes(ctx context.Context, userID, sessionID uuid.UUID, currentPassword string, client ClientInfo) ([]string, error) {
	if _, err := s.verifyCurrentPassword(ctx, userID, currentPassword); err != nil {
		s.audit(ctx, &userID, &sessionID, "recovery_codes_regenerated", "failure", client, map[string]interface{}{"reason": "invalid_password"})
		return nil, err
	}

	now := s.now().UTC()
	displayCodes := make([]string, 0, recoveryCodeCount)
	records := make([]*AccountRecoveryCode, 0, recoveryCodeCount)
	for i := 0; i < recoveryCodeCount; i++ {
		display, canonical, err := s.generateRecoveryCode()
		if err != nil {
			return nil, s.internalError("failed to generate recovery codes", err)
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(canonical), s.passwordCost)
		if err != nil {
			return nil, s.internalError("failed to generate recovery codes", err)
		}
		displayCodes = append(displayCodes, display)
		records = append(records, &AccountRecoveryCode{
			ID:        uuid.New(),
			UserID:    userID,
			CodeHash:  string(hash),
			CreatedAt: now,
		})
	}
	if err := s.repo.ReplaceRecoveryCodes(ctx, userID, records); err != nil {
		return nil, s.internalError("failed to generate recovery codes", err)
	}
	s.audit(ctx, &userID, &sessionID, "recovery_codes_regenerated", "success", client, nil)
	return displayCodes, nil
}

func (s *Service) ResetPasswordWithRecoveryCode(ctx context.Context, req *RecoveryCodeResetRequest, client ClientInfo) error {
	if req == nil {
		return common.NewValidationError("password reset request is required")
	}
	if appErr := validatePassword(req.NewPassword); appErr != nil {
		return appErr
	}
	email, err := canonicalEmail(req.Email)
	if err != nil {
		s.audit(ctx, nil, nil, "password_reset_recovery_code", "failure", client, map[string]interface{}{"reason": "invalid_code"})
		return invalidRecoveryCodeError()
	}
	canonicalCode := canonicalRecoveryCode(req.RecoveryCode)
	if !recoveryCodePattern.MatchString(canonicalCode) {
		s.audit(ctx, nil, nil, "password_reset_recovery_code", "failure", client, map[string]interface{}{"reason": "invalid_code"})
		return invalidRecoveryCodeError()
	}

	user, err := s.repo.GetUserByEmail(ctx, email)
	if err != nil || !accountIsActive(user) {
		if err != nil && !errors.Is(err, ErrUserNotFound) {
			return s.internalError("password reset failed", err)
		}
		s.audit(ctx, nil, nil, "password_reset_recovery_code", "failure", client, map[string]interface{}{"reason": "invalid_code"})
		return invalidRecoveryCodeError()
	}
	codes, err := s.repo.GetUnusedRecoveryCodes(ctx, user.ID)
	if err != nil {
		return s.internalError("password reset failed", err)
	}
	var matched *AccountRecoveryCode
	for _, code := range codes {
		if bcrypt.CompareHashAndPassword([]byte(code.CodeHash), []byte(canonicalCode)) == nil {
			matched = code
			break
		}
	}
	if matched == nil {
		s.audit(ctx, &user.ID, nil, "password_reset_recovery_code", "failure", client, map[string]interface{}{"reason": "invalid_code"})
		return invalidRecoveryCodeError()
	}
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), s.passwordCost)
	if err != nil {
		return s.internalError("password reset failed", err)
	}
	if err := s.repo.ResetPasswordWithRecoveryCode(ctx, user.ID, matched.ID, string(passwordHash), s.now().UTC()); err != nil {
		if errors.Is(err, ErrRecoveryCodeUsed) {
			return invalidRecoveryCodeError()
		}
		return s.internalError("password reset failed", err)
	}
	s.audit(ctx, &user.ID, nil, "password_reset_recovery_code", "success", client, nil)
	return nil
}

func (s *Service) DeactivateAccount(ctx context.Context, userID, sessionID uuid.UUID, currentPassword string, client ClientInfo) error {
	if _, err := s.verifyCurrentPassword(ctx, userID, currentPassword); err != nil {
		s.audit(ctx, &userID, &sessionID, "account_deactivated", "failure", client, map[string]interface{}{"reason": "invalid_password"})
		return err
	}
	if err := s.repo.DeactivateAccount(ctx, userID, s.now().UTC()); err != nil {
		return s.internalError("failed to deactivate account", err)
	}
	s.audit(ctx, &userID, &sessionID, "account_deactivated", "success", client, nil)
	return nil
}

func (s *Service) ReactivateAccount(ctx context.Context, req *ReactivateAccountRequest, client ClientInfo) (*LoginResponse, error) {
	if req == nil {
		s.audit(ctx, nil, nil, "account_reactivated", "failure", client, map[string]interface{}{"reason": "invalid_credentials"})
		return nil, invalidCredentialsError()
	}
	email, err := canonicalEmail(req.Email)
	if err != nil {
		s.audit(ctx, nil, nil, "account_reactivated", "failure", client, map[string]interface{}{"reason": "invalid_credentials"})
		return nil, invalidCredentialsError()
	}
	user, err := s.repo.GetUserByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, ErrUserNotFound) {
			s.audit(ctx, nil, nil, "account_reactivated", "failure", client, map[string]interface{}{"reason": "invalid_credentials"})
			return nil, invalidCredentialsError()
		}
		return nil, s.internalError("account reactivation failed", err)
	}
	if user.DeletedAt != nil || user.AccountStatus == models.AccountStatusDeleted || bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)) != nil {
		s.audit(ctx, &user.ID, nil, "account_reactivated", "failure", client, map[string]interface{}{"reason": "invalid_credentials"})
		return nil, invalidCredentialsError()
	}
	if user.AccountStatus == models.AccountStatusActive && user.IsActive {
		return nil, common.NewErrorWithCode(http.StatusConflict, errCodeAccountAlreadyActive, "account is already active", common.ErrConflict)
	}
	if user.AccountStatus != models.AccountStatusDeactivated {
		s.audit(ctx, &user.ID, nil, "account_reactivated", "failure", client, map[string]interface{}{"reason": "invalid_account_state"})
		return nil, invalidCredentialsError()
	}

	response, session, err := s.createReactivationResponse(ctx, user, req.RememberMe, req.DeviceName, client)
	if err != nil {
		return nil, err
	}
	s.audit(ctx, &user.ID, &session.ID, "account_reactivated", "success", client, nil)
	return response, nil
}

func (s *Service) DeleteAccount(ctx context.Context, userID, sessionID uuid.UUID, currentPassword string, client ClientInfo) error {
	if _, err := s.verifyCurrentPassword(ctx, userID, currentPassword); err != nil {
		s.audit(ctx, &userID, &sessionID, "account_deleted", "failure", client, map[string]interface{}{"reason": "invalid_password"})
		return err
	}
	compactID := strings.ReplaceAll(userID.String(), "-", "")
	anonymizedEmail := "deleted+" + compactID + "@deleted.invalid"
	anonymizedPhone := "deleted-" + compactID[:12]
	invalidPasswordHash := "!deleted:" + userID.String()
	if err := s.repo.DeleteAccount(ctx, userID, anonymizedEmail, anonymizedPhone, invalidPasswordHash, s.now().UTC()); err != nil {
		return s.internalError("failed to delete account", err)
	}
	// Do not reintroduce IP address or user-agent data after anonymization.
	s.audit(ctx, &userID, &sessionID, "account_deleted", "success", ClientInfo{}, nil)
	return nil
}

func (s *Service) createLoginResponse(ctx context.Context, user *models.User, rememberMe bool, deviceName string, client ClientInfo) (*LoginResponse, *AuthSession, error) {
	signer, err := s.prepareSigningKey(ctx)
	if err != nil {
		return nil, nil, s.internalError("login failed", err)
	}
	refreshToken, err := s.randomToken(32)
	if err != nil {
		return nil, nil, s.internalError("login failed", err)
	}
	now := s.now().UTC()
	session := newSession(user, refreshToken, rememberMe, deviceName, client, now)
	accessToken, err := s.signAccessToken(user, session.ID, now, signer)
	if err != nil {
		return nil, nil, s.internalError("login failed", err)
	}
	if err := s.repo.CreateSession(ctx, session); err != nil {
		return nil, nil, s.internalError("login failed", err)
	}
	return loginResponse(user, session, accessToken, refreshToken), session, nil
}

func (s *Service) createReactivationResponse(ctx context.Context, user *models.User, rememberMe bool, deviceName string, client ClientInfo) (*LoginResponse, *AuthSession, error) {
	signer, err := s.prepareSigningKey(ctx)
	if err != nil {
		return nil, nil, s.internalError("account reactivation failed", err)
	}
	refreshToken, err := s.randomToken(32)
	if err != nil {
		return nil, nil, s.internalError("account reactivation failed", err)
	}
	now := s.now().UTC()
	session := newSession(user, refreshToken, rememberMe, deviceName, client, now)
	session.AuthVersion = user.AuthVersion + 1
	accessToken, err := s.signAccessToken(user, session.ID, now, signer)
	if err != nil {
		return nil, nil, s.internalError("account reactivation failed", err)
	}
	if err := s.repo.ReactivateAccount(ctx, user.ID, session, now); err != nil {
		if errors.Is(err, ErrInvalidAccountState) {
			return nil, nil, common.NewErrorWithCode(http.StatusConflict, errCodeAccountAlreadyActive, "account state changed; retry login", common.ErrConflict)
		}
		return nil, nil, s.internalError("account reactivation failed", err)
	}
	user.AccountStatus = models.AccountStatusActive
	user.IsActive = true
	user.AuthVersion = session.AuthVersion
	return loginResponse(user, session, accessToken, refreshToken), session, nil
}

func newSession(user *models.User, refreshToken string, rememberMe bool, deviceName string, client ClientInfo, now time.Time) *AuthSession {
	ttl := defaultSessionTTL
	if rememberMe {
		ttl = rememberedSessionTTL
	}
	deviceName = strings.TrimSpace(deviceName)
	if utf8.RuneCountInString(deviceName) > 255 {
		deviceName = string([]rune(deviceName)[:255])
	}
	ipAddress, userAgent := sanitizedClient(client)
	return &AuthSession{
		ID:               uuid.New(),
		UserID:           user.ID,
		RefreshTokenHash: tokenHash(refreshToken),
		AuthVersion:      user.AuthVersion,
		RememberMe:       rememberMe,
		DeviceName:       optionalString(deviceName),
		IPAddress:        ipAddress,
		UserAgent:        userAgent,
		CreatedAt:        now,
		LastUsedAt:       now,
		ExpiresAt:        now.Add(ttl),
	}
}

func loginResponse(user *models.User, session *AuthSession, accessToken, refreshToken string) *LoginResponse {
	return &LoginResponse{
		User:         publicUser(user),
		Token:        accessToken,
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		TokenType:    "Bearer",
		ExpiresIn:    int64(accessTokenTTL / time.Second),
		Session:      sessionResponse(session, session.ID),
	}
}

func (s *Service) verifyCurrentPassword(ctx context.Context, userID uuid.UUID, password string) (*models.User, error) {
	user, err := s.repo.GetUserByID(ctx, userID)
	if err != nil {
		if errors.Is(err, ErrUserNotFound) {
			return nil, invalidSessionError()
		}
		return nil, s.internalError("account verification failed", err)
	}
	if !accountIsActive(user) {
		return nil, invalidSessionError()
	}
	if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)) != nil {
		return nil, currentPasswordError()
	}
	return user, nil
}

func (s *Service) prepareSigningKey(ctx context.Context) (*signingMaterial, error) {
	if s.keyManager == nil {
		return nil, errors.New("jwt key manager is not configured")
	}
	if err := s.keyManager.EnsureRotation(ctx); err != nil {
		return nil, fmt.Errorf("rotate signing key: %w", err)
	}
	key, err := s.keyManager.CurrentSigningKey()
	if err != nil {
		return nil, fmt.Errorf("get signing key: %w", err)
	}
	secret, err := key.SecretBytes()
	if err != nil {
		return nil, fmt.Errorf("decode signing key: %w", err)
	}
	return &signingMaterial{keyID: key.ID, secret: secret}, nil
}

func (s *Service) signAccessToken(user *models.User, sessionID uuid.UUID, now time.Time, signer *signingMaterial) (string, error) {
	claims := &middleware.Claims{
		UserID:    user.ID,
		SessionID: sessionID,
		Email:     user.Email,
		Role:      user.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    middleware.AccessTokenIssuer,
			Subject:   user.ID.String(),
			Audience:  jwt.ClaimStrings{middleware.AccessTokenAudience},
			ExpiresAt: jwt.NewNumericDate(now.Add(accessTokenTTL)),
			NotBefore: jwt.NewNumericDate(now),
			IssuedAt:  jwt.NewNumericDate(now),
			ID:        uuid.NewString(),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	token.Header["kid"] = signer.keyID
	signed, err := token.SignedString(signer.secret)
	if err != nil {
		return "", fmt.Errorf("sign access token: %w", err)
	}
	return signed, nil
}

func (s *Service) randomToken(size int) (string, error) {
	value := make([]byte, size)
	if _, err := io.ReadFull(s.random, value); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func (s *Service) generateRecoveryCode() (string, string, error) {
	value := make([]byte, 10)
	if _, err := io.ReadFull(s.random, value); err != nil {
		return "", "", err
	}
	canonical := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(value)
	display := strings.Join([]string{canonical[0:4], canonical[4:8], canonical[8:12], canonical[12:16]}, "-")
	return display, canonical, nil
}

func (s *Service) audit(ctx context.Context, userID, sessionID *uuid.UUID, eventType, status string, client ClientInfo, metadata map[string]interface{}) {
	ipAddress, userAgent := sanitizedClient(client)
	event := &AuditEvent{
		ID:          uuid.New(),
		UserID:      userID,
		SessionID:   sessionID,
		EventType:   eventType,
		EventStatus: status,
		IPAddress:   ipAddress,
		UserAgent:   userAgent,
		Metadata:    metadata,
	}
	if err := s.repo.CreateAuditEvent(ctx, event); err != nil {
		s.logger.Warn("failed to persist auth audit event", zap.String("event_type", eventType), zap.Error(err))
	}
}

func (s *Service) internalError(message string, err error) error {
	s.logger.Error(message, zap.Error(err))
	return common.NewInternalError(message, err)
}

func canonicalRegistration(req *models.RegisterRequest) (*models.RegisterRequest, *common.AppError) {
	if req == nil {
		return nil, common.NewValidationError("registration request is required")
	}
	if req.Role != models.RoleRider {
		return nil, common.NewValidationError("public registration supports rider accounts only")
	}
	email, err := canonicalEmail(req.Email)
	if err != nil {
		return nil, common.NewValidationError("email must be a valid email address")
	}
	phone, appErr := canonicalPhone(req.PhoneNumber)
	if appErr != nil {
		return nil, appErr
	}
	firstName, appErr := canonicalName(req.FirstName, "first_name")
	if appErr != nil {
		return nil, appErr
	}
	lastName, appErr := canonicalName(req.LastName, "last_name")
	if appErr != nil {
		return nil, appErr
	}
	if appErr := validatePassword(req.Password); appErr != nil {
		return nil, appErr
	}
	termsVersion := strings.TrimSpace(req.TermsVersion)
	if termsVersion == "" || utf8.RuneCountInString(termsVersion) > 100 {
		return nil, common.NewValidationError("terms_version is required and must be at most 100 characters")
	}
	copy := *req
	copy.Email = email
	copy.PhoneNumber = phone
	copy.FirstName = firstName
	copy.LastName = lastName
	copy.Role = models.RoleRider
	copy.TermsVersion = termsVersion
	return &copy, nil
}

func canonicalEmail(value string) (string, error) {
	email := strings.ToLower(strings.TrimSpace(value))
	if email == "" || len(email) > 255 || !emailPattern.MatchString(email) {
		return "", errors.New("invalid email")
	}
	return email, nil
}

func canonicalPhone(value string) (string, *common.AppError) {
	cleaned := strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) || r == '-' || r == '(' || r == ')' {
			return -1
		}
		return r
	}, strings.TrimSpace(value))
	switch {
	case strings.HasPrefix(cleaned, "+977"):
	case strings.HasPrefix(cleaned, "977"):
		cleaned = "+" + cleaned
	case strings.HasPrefix(cleaned, "0"):
		cleaned = "+977" + strings.TrimPrefix(cleaned, "0")
	default:
		cleaned = "+977" + cleaned
	}
	if !nepaliMobilePattern.MatchString(cleaned) {
		return "", common.NewValidationError("phone_number must be a valid Nepali mobile number")
	}
	return cleaned, nil
}

func canonicalName(value, field string) (string, *common.AppError) {
	name := strings.TrimSpace(value)
	length := utf8.RuneCountInString(name)
	if !utf8.ValidString(name) || length < 1 || length > 100 {
		return "", common.NewValidationError(field + " must contain 1 to 100 characters")
	}
	return name, nil
}

func validatePassword(password string) *common.AppError {
	length := len([]byte(password))
	if length < 8 || length > 72 {
		return common.NewValidationError("password must contain 8 to 72 bytes")
	}
	return nil
}

func canonicalRecoveryCode(value string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) || r == '-' {
			return -1
		}
		return unicode.ToUpper(r)
	}, value)
}

func tokenHash(token string) string {
	hash := sha256.Sum256([]byte(token))
	return hex.EncodeToString(hash[:])
}

func accountIsActive(user *models.User) bool {
	return user != nil && user.IsActive && user.AccountStatus == models.AccountStatusActive && user.DeletedAt == nil
}

func publicUser(user *models.User) *models.User {
	if user == nil {
		return nil
	}
	copy := *user
	copy.PasswordHash = ""
	return &copy
}

func sanitizedClient(client ClientInfo) (*string, *string) {
	var ipAddress *string
	if ip := net.ParseIP(strings.TrimSpace(client.IPAddress)); ip != nil {
		value := ip.String()
		ipAddress = &value
	}
	userAgent := strings.TrimSpace(client.UserAgent)
	if utf8.RuneCountInString(userAgent) > 1024 {
		userAgent = string([]rune(userAgent)[:1024])
	}
	return ipAddress, optionalString(userAgent)
}

func optionalString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func invalidCredentialsError() *common.AppError {
	return common.NewErrorWithCode(http.StatusUnauthorized, common.ErrCodeInvalidCredentials, "invalid credentials", common.ErrInvalidCredentials)
}

func currentPasswordError() *common.AppError {
	return common.NewErrorWithCode(http.StatusUnauthorized, common.ErrCodeInvalidCredentials, "current password is incorrect", common.ErrInvalidCredentials)
}

func invalidSessionError() *common.AppError {
	return common.NewErrorWithCode(http.StatusUnauthorized, errCodeInvalidSession, "session is invalid or expired", common.ErrInvalidToken)
}

func invalidRecoveryCodeError() *common.AppError {
	return common.NewErrorWithCode(http.StatusUnauthorized, errCodeInvalidRecoveryCode, "recovery code is invalid or already used", common.ErrInvalidCredentials)
}

func conflictError(errorCode, message string) *common.AppError {
	return common.NewErrorWithCode(http.StatusConflict, errorCode, message, common.ErrConflict)
}
