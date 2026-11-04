package auth

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/common"
	"github.com/bikky-kc013/medi-ambulance/pkg/jwtkeys"
	"github.com/bikky-kc013/medi-ambulance/pkg/middleware"
	"github.com/bikky-kc013/medi-ambulance/pkg/models"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"
)

var testNow = time.Date(2026, time.November, 4, 12, 0, 0, 0, time.UTC)

type fakeRepository struct {
	users        map[uuid.UUID]*models.User
	sessions     map[uuid.UUID]*AuthSession
	recovery     map[uuid.UUID][]*AccountRecoveryCode
	audits       []*AuditEvent
	deletedEmail string
	deletedPhone string
}

func newFakeRepository() *fakeRepository {
	return &fakeRepository{
		users:    make(map[uuid.UUID]*models.User),
		sessions: make(map[uuid.UUID]*AuthSession),
		recovery: make(map[uuid.UUID][]*AccountRecoveryCode),
	}
}

func (f *fakeRepository) CreateUser(_ context.Context, user *models.User) error {
	for _, existing := range f.users {
		if strings.EqualFold(existing.Email, user.Email) {
			return ErrDuplicateEmail
		}
		if existing.PhoneNumber == user.PhoneNumber {
			return ErrDuplicatePhone
		}
	}
	f.users[user.ID] = cloneUser(user)
	return nil
}

func (f *fakeRepository) GetUserByEmail(_ context.Context, email string) (*models.User, error) {
	for _, user := range f.users {
		if strings.EqualFold(user.Email, email) {
			return cloneUser(user), nil
		}
	}
	return nil, ErrUserNotFound
}

func (f *fakeRepository) GetUserByPhone(_ context.Context, phone string) (*models.User, error) {
	for _, user := range f.users {
		if user.PhoneNumber == phone {
			return cloneUser(user), nil
		}
	}
	return nil, ErrUserNotFound
}

func (f *fakeRepository) GetUserByID(_ context.Context, id uuid.UUID) (*models.User, error) {
	user := f.users[id]
	if user == nil {
		return nil, ErrUserNotFound
	}
	return cloneUser(user), nil
}

func (f *fakeRepository) UpdateProfile(_ context.Context, userID uuid.UUID, changes ProfileChanges) (*models.User, error) {
	user := f.users[userID]
	if user == nil || !accountIsActive(user) {
		return nil, ErrUserNotFound
	}
	if changes.PhoneNumber != nil {
		for id, existing := range f.users {
			if id != userID && existing.PhoneNumber == *changes.PhoneNumber {
				return nil, ErrDuplicatePhone
			}
		}
		user.PhoneNumber = *changes.PhoneNumber
	}
	if changes.FirstName != nil {
		user.FirstName = *changes.FirstName
	}
	if changes.LastName != nil {
		user.LastName = *changes.LastName
	}
	if changes.ProfileImage != nil {
		value := *changes.ProfileImage
		user.ProfileImage = &value
	}
	return cloneUser(user), nil
}

func (f *fakeRepository) CreateSession(_ context.Context, session *AuthSession) error {
	f.sessions[session.ID] = cloneSession(session)
	return nil
}

func (f *fakeRepository) RotateSession(_ context.Context, currentHash, replacementHash string, usedAt time.Time) (*AuthSession, *models.User, error) {
	for _, session := range f.sessions {
		user := f.users[session.UserID]
		if session.RefreshTokenHash != currentHash || session.RevokedAt != nil || !session.ExpiresAt.After(usedAt) || !accountIsActive(user) || session.AuthVersion != user.AuthVersion {
			continue
		}
		session.RefreshTokenHash = replacementHash
		session.LastUsedAt = usedAt
		return cloneSession(session), cloneUser(user), nil
	}
	return nil, nil, ErrInvalidRefreshToken
}

func (f *fakeRepository) ValidateSession(_ context.Context, userID, sessionID uuid.UUID, now time.Time) error {
	session := f.sessions[sessionID]
	user := f.users[userID]
	if session == nil || session.UserID != userID || session.RevokedAt != nil || !session.ExpiresAt.After(now) || !accountIsActive(user) || session.AuthVersion != user.AuthVersion {
		return ErrSessionNotFound
	}
	return nil
}

func (f *fakeRepository) ListSessions(_ context.Context, userID uuid.UUID, now time.Time) ([]*AuthSession, error) {
	var sessions []*AuthSession
	for _, session := range f.sessions {
		if session.UserID == userID && session.RevokedAt == nil && session.ExpiresAt.After(now) {
			sessions = append(sessions, cloneSession(session))
		}
	}
	return sessions, nil
}

func (f *fakeRepository) RevokeSession(_ context.Context, userID, sessionID uuid.UUID, reason string, now time.Time) error {
	session := f.sessions[sessionID]
	if session == nil || session.UserID != userID || session.RevokedAt != nil {
		return ErrSessionNotFound
	}
	session.RevokedAt = timePointer(now)
	session.RevocationReason = stringPointer(reason)
	return nil
}

func (f *fakeRepository) RevokeAllSessions(_ context.Context, userID uuid.UUID, reason string, exceptSessionID *uuid.UUID, now time.Time) (int64, error) {
	var count int64
	for _, session := range f.sessions {
		if session.UserID != userID || session.RevokedAt != nil || (exceptSessionID != nil && session.ID == *exceptSessionID) {
			continue
		}
		session.RevokedAt = timePointer(now)
		session.RevocationReason = stringPointer(reason)
		count++
	}
	return count, nil
}

func (f *fakeRepository) ChangePassword(_ context.Context, userID, currentSessionID uuid.UUID, passwordHash string, now time.Time) error {
	user := f.users[userID]
	current := f.sessions[currentSessionID]
	if !accountIsActive(user) || current == nil || current.UserID != userID || current.RevokedAt != nil {
		return ErrSessionNotFound
	}
	user.PasswordHash = passwordHash
	user.AuthVersion++
	current.AuthVersion = user.AuthVersion
	for id, session := range f.sessions {
		if session.UserID == userID && id != currentSessionID && session.RevokedAt == nil {
			session.RevokedAt = timePointer(now)
			session.RevocationReason = stringPointer("password_changed")
		}
	}
	return nil
}

func (f *fakeRepository) ReplaceRecoveryCodes(_ context.Context, userID uuid.UUID, codes []*AccountRecoveryCode) error {
	f.recovery[userID] = cloneCodes(codes)
	return nil
}

func (f *fakeRepository) GetUnusedRecoveryCodes(_ context.Context, userID uuid.UUID) ([]*AccountRecoveryCode, error) {
	var result []*AccountRecoveryCode
	for _, code := range f.recovery[userID] {
		if code.UsedAt == nil {
			copy := *code
			result = append(result, &copy)
		}
	}
	return result, nil
}

func (f *fakeRepository) ResetPasswordWithRecoveryCode(_ context.Context, userID, codeID uuid.UUID, passwordHash string, now time.Time) error {
	var found *AccountRecoveryCode
	for _, code := range f.recovery[userID] {
		if code.ID == codeID && code.UsedAt == nil {
			found = code
			break
		}
	}
	if found == nil {
		return ErrRecoveryCodeUsed
	}
	found.UsedAt = timePointer(now)
	user := f.users[userID]
	user.PasswordHash = passwordHash
	user.AuthVersion++
	_, _ = f.RevokeAllSessions(context.Background(), userID, "password_recovery", nil, now)
	return nil
}

func (f *fakeRepository) DeactivateAccount(_ context.Context, userID uuid.UUID, now time.Time) error {
	user := f.users[userID]
	if !accountIsActive(user) {
		return ErrInvalidAccountState
	}
	user.AccountStatus = models.AccountStatusDeactivated
	user.IsActive = false
	user.AuthVersion++
	_, _ = f.RevokeAllSessions(context.Background(), userID, "account_deactivated", nil, now)
	return nil
}

func (f *fakeRepository) ReactivateAccount(_ context.Context, userID uuid.UUID, session *AuthSession, _ time.Time) error {
	user := f.users[userID]
	if user == nil || user.AccountStatus != models.AccountStatusDeactivated || user.IsActive || user.DeletedAt != nil {
		return ErrInvalidAccountState
	}
	user.AccountStatus = models.AccountStatusActive
	user.IsActive = true
	user.AuthVersion++
	session.AuthVersion = user.AuthVersion
	f.sessions[session.ID] = cloneSession(session)
	return nil
}

func (f *fakeRepository) DeleteAccount(_ context.Context, userID uuid.UUID, anonymizedEmail, anonymizedPhone, invalidPasswordHash string, now time.Time) error {
	user := f.users[userID]
	if user == nil || user.AccountStatus == models.AccountStatusDeleted {
		return ErrInvalidAccountState
	}
	f.deletedEmail = anonymizedEmail
	f.deletedPhone = anonymizedPhone
	user.Email = anonymizedEmail
	user.PhoneNumber = anonymizedPhone
	user.PasswordHash = invalidPasswordHash
	user.FirstName = "Deleted"
	user.LastName = "User"
	user.ProfileImage = nil
	user.AccountStatus = models.AccountStatusDeleted
	user.IsActive = false
	user.AuthVersion++
	user.DeletedAt = timePointer(now)
	_, _ = f.RevokeAllSessions(context.Background(), userID, "account_deleted", nil, now)
	delete(f.recovery, userID)
	return nil
}

func (f *fakeRepository) CreateAuditEvent(_ context.Context, event *AuditEvent) error {
	copy := *event
	if event.Metadata != nil {
		copy.Metadata = make(map[string]interface{}, len(event.Metadata))
		for key, value := range event.Metadata {
			copy.Metadata[key] = value
		}
	}
	f.audits = append(f.audits, &copy)
	return nil
}

func TestRegisterCanonicalizesAndValidates(t *testing.T) {
	service, repo, _ := newTestService(t)
	req := &models.RegisterRequest{
		Email:        "  Rider@Example.COM ",
		Password:     "password1",
		PhoneNumber:  "98 1234-5678",
		FirstName:    "  Asha ",
		LastName:     " Gurung  ",
		Role:         models.RoleRider,
		TermsVersion: " 2026-11 ",
	}

	user, err := service.Register(context.Background(), req, ClientInfo{IPAddress: "127.0.0.1"})
	require.NoError(t, err)
	assert.Equal(t, "rider@example.com", user.Email)
	assert.Equal(t, "+9779812345678", user.PhoneNumber)
	assert.Equal(t, "Asha", user.FirstName)
	assert.Equal(t, "Gurung", user.LastName)
	assert.Equal(t, "2026-11", *user.TermsVersion)
	assert.Empty(t, user.PasswordHash)
	stored := repo.users[user.ID]
	assert.NoError(t, bcrypt.CompareHashAndPassword([]byte(stored.PasswordHash), []byte(req.Password)))
	require.Len(t, repo.audits, 1)
	assert.Equal(t, "register", repo.audits[0].EventType)

	tests := []struct {
		name   string
		mutate func(*models.RegisterRequest)
	}{
		{name: "rider only", mutate: func(value *models.RegisterRequest) { value.Role = models.RoleDriver }},
		{name: "trimmed names required", mutate: func(value *models.RegisterRequest) { value.FirstName = "   " }},
		{name: "password maximum is bytes", mutate: func(value *models.RegisterRequest) { value.Password = strings.Repeat("x", 73) }},
		{name: "terms required", mutate: func(value *models.RegisterRequest) { value.TermsVersion = " " }},
		{name: "Nepali phone required", mutate: func(value *models.RegisterRequest) { value.PhoneNumber = "+15551234567" }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			candidate := *req
			candidate.Email = strings.Replace(req.Email, "Rider", strings.ReplaceAll(test.name, " ", ""), 1)
			test.mutate(&candidate)
			_, err := service.Register(context.Background(), &candidate, ClientInfo{})
			assertAppError(t, err, 400, common.ErrCodeValidation)
		})
	}
}

func TestRegisterDuplicateEmailAndPhoneAreConflicts(t *testing.T) {
	service, _, _ := newTestService(t)
	base := models.RegisterRequest{Email: "one@example.com", Password: "password1", PhoneNumber: "9812345678", FirstName: "One", LastName: "Rider", Role: models.RoleRider, TermsVersion: "v1"}
	_, err := service.Register(context.Background(), &base, ClientInfo{})
	require.NoError(t, err)

	duplicateEmail := base
	duplicateEmail.Email = " ONE@EXAMPLE.COM "
	duplicateEmail.PhoneNumber = "9800000000"
	_, err = service.Register(context.Background(), &duplicateEmail, ClientInfo{})
	assertAppError(t, err, 409, errCodeEmailExists)

	duplicatePhone := base
	duplicatePhone.Email = "two@example.com"
	duplicatePhone.PhoneNumber = "+977 9812345678"
	_, err = service.Register(context.Background(), &duplicatePhone, ClientInfo{})
	assertAppError(t, err, 409, errCodePhoneExists)
}

func TestLoginCreatesHashedSessionAndStrictAccessToken(t *testing.T) {
	service, repo, manager := newTestService(t)
	user := addTestUser(t, repo, "login@example.com", "+9779811111111", "password1")

	response, err := service.Login(context.Background(), &models.LoginRequest{
		Email: " LOGIN@example.com ", Password: "password1", RememberMe: true, DeviceName: "Pixel",
	}, ClientInfo{IPAddress: "10.0.0.2", UserAgent: "test-agent"})
	require.NoError(t, err)
	assert.Equal(t, response.AccessToken, response.Token)
	assert.NotEmpty(t, response.RefreshToken)
	assert.Equal(t, int64(900), response.ExpiresIn)
	session := repo.sessions[response.Session.ID]
	require.NotNil(t, session)
	assert.Equal(t, tokenHash(response.RefreshToken), session.RefreshTokenHash)
	assert.NotEqual(t, response.RefreshToken, session.RefreshTokenHash)
	assert.Equal(t, rememberedSessionTTL, session.ExpiresAt.Sub(testNow))

	claims := parseAccessToken(t, manager, response.AccessToken)
	assert.Equal(t, user.ID, claims.UserID)
	assert.Equal(t, session.ID, claims.SessionID)
	assert.Equal(t, user.ID.String(), claims.Subject)
	assert.Equal(t, middleware.AccessTokenIssuer, claims.Issuer)
	assert.Contains(t, claims.Audience, middleware.AccessTokenAudience)
	assert.NotEmpty(t, claims.ID)
	assert.Equal(t, accessTokenTTL, claims.ExpiresAt.Time.Sub(claims.IssuedAt.Time))

	response, err = service.Login(context.Background(), &models.LoginRequest{Email: user.Email, Password: "password1"}, ClientInfo{})
	require.NoError(t, err)
	assert.Equal(t, defaultSessionTTL, repo.sessions[response.Session.ID].ExpiresAt.Sub(testNow))
}

func TestLoginRejectsDeactivatedAndBadCredentials(t *testing.T) {
	service, repo, _ := newTestService(t)
	user := addTestUser(t, repo, "inactive@example.com", "+9779811111112", "password1")
	user.AccountStatus = models.AccountStatusDeactivated
	user.IsActive = false
	repo.users[user.ID] = cloneUser(user)

	_, err := service.Login(context.Background(), &models.LoginRequest{Email: user.Email, Password: "password1"}, ClientInfo{})
	assertAppError(t, err, 403, errCodeAccountDeactivated)
	_, err = service.Login(context.Background(), &models.LoginRequest{Email: user.Email, Password: "wrong-password"}, ClientInfo{})
	assertAppError(t, err, 401, common.ErrCodeInvalidCredentials)
	_, err = service.Login(context.Background(), &models.LoginRequest{Email: "missing@example.com", Password: "password1"}, ClientInfo{})
	assertAppError(t, err, 401, common.ErrCodeInvalidCredentials)
	for _, audit := range repo.audits {
		assert.NotContains(t, audit.Metadata, "email")
	}
}

func TestRefreshRotatesOpaqueTokenAndRejectsReuse(t *testing.T) {
	service, repo, _ := newTestService(t)
	user := addTestUser(t, repo, "refresh@example.com", "+9779811111113", "password1")
	login, err := service.Login(context.Background(), &models.LoginRequest{Email: user.Email, Password: "password1", RememberMe: true}, ClientInfo{})
	require.NoError(t, err)
	oldRefresh := login.RefreshToken
	oldExpiry := repo.sessions[login.Session.ID].ExpiresAt

	service.now = func() time.Time { return testNow.Add(time.Hour) }
	refreshed, err := service.Refresh(context.Background(), &RefreshTokenRequest{RefreshToken: oldRefresh}, ClientInfo{})
	require.NoError(t, err)
	assert.NotEqual(t, oldRefresh, refreshed.RefreshToken)
	assert.Equal(t, login.Session.ID, refreshed.Session.ID)
	assert.Equal(t, oldExpiry, repo.sessions[login.Session.ID].ExpiresAt)
	assert.Equal(t, tokenHash(refreshed.RefreshToken), repo.sessions[login.Session.ID].RefreshTokenHash)

	_, err = service.Refresh(context.Background(), &RefreshTokenRequest{RefreshToken: oldRefresh}, ClientInfo{})
	assertAppError(t, err, 401, errCodeInvalidSession)
}

func TestSessionValidationLogoutAndOwnership(t *testing.T) {
	service, repo, _ := newTestService(t)
	owner := addTestUser(t, repo, "owner@example.com", "+9779811111114", "password1")
	other := addTestUser(t, repo, "other@example.com", "+9779811111115", "password1")
	ownerLogin, err := service.Login(context.Background(), &models.LoginRequest{Email: owner.Email, Password: "password1"}, ClientInfo{})
	require.NoError(t, err)
	otherLogin, err := service.Login(context.Background(), &models.LoginRequest{Email: other.Email, Password: "password1"}, ClientInfo{})
	require.NoError(t, err)

	require.NoError(t, service.ValidateActiveSession(context.Background(), owner.ID, ownerLogin.Session.ID))
	err = service.RevokeSession(context.Background(), owner.ID, ownerLogin.Session.ID, otherLogin.Session.ID, ClientInfo{})
	assertAppError(t, err, 404, common.ErrCodeNotFound)
	assert.Nil(t, repo.sessions[otherLogin.Session.ID].RevokedAt)

	require.NoError(t, service.Logout(context.Background(), owner.ID, ownerLogin.Session.ID, ClientInfo{}))
	err = service.ValidateActiveSession(context.Background(), owner.ID, ownerLogin.Session.ID)
	assertAppError(t, err, 401, errCodeInvalidSession)
}

func TestListAndRevokeAllSessionsRequiresCurrentPassword(t *testing.T) {
	service, repo, _ := newTestService(t)
	user := addTestUser(t, repo, "all-sessions@example.com", "+9779811111120", "password1")
	current, err := service.Login(context.Background(), &models.LoginRequest{Email: user.Email, Password: "password1"}, ClientInfo{})
	require.NoError(t, err)
	other, err := service.Login(context.Background(), &models.LoginRequest{Email: user.Email, Password: "password1"}, ClientInfo{})
	require.NoError(t, err)

	sessions, err := service.ListSessions(context.Background(), user.ID, current.Session.ID)
	require.NoError(t, err)
	require.Len(t, sessions, 2)
	var currentCount int
	for _, session := range sessions {
		if session.Current {
			currentCount++
		}
	}
	assert.Equal(t, 1, currentCount)

	err = service.RevokeAllSessions(context.Background(), user.ID, current.Session.ID, "wrong-password", ClientInfo{})
	assertAppError(t, err, 401, common.ErrCodeInvalidCredentials)
	assert.Nil(t, repo.sessions[current.Session.ID].RevokedAt)
	assert.Nil(t, repo.sessions[other.Session.ID].RevokedAt)

	require.NoError(t, service.RevokeAllSessions(context.Background(), user.ID, current.Session.ID, "password1", ClientInfo{}))
	assert.NotNil(t, repo.sessions[current.Session.ID].RevokedAt)
	assert.NotNil(t, repo.sessions[other.Session.ID].RevokedAt)
}

func TestChangePasswordRevokesOnlyOtherSessions(t *testing.T) {
	service, repo, _ := newTestService(t)
	user := addTestUser(t, repo, "change@example.com", "+9779811111116", "password1")
	current, err := service.Login(context.Background(), &models.LoginRequest{Email: user.Email, Password: "password1"}, ClientInfo{})
	require.NoError(t, err)
	other, err := service.Login(context.Background(), &models.LoginRequest{Email: user.Email, Password: "password1"}, ClientInfo{})
	require.NoError(t, err)

	err = service.ChangePassword(context.Background(), user.ID, current.Session.ID, &ChangePasswordRequest{CurrentPassword: "password1", NewPassword: "password2"}, ClientInfo{})
	require.NoError(t, err)
	assert.Nil(t, repo.sessions[current.Session.ID].RevokedAt)
	assert.NotNil(t, repo.sessions[other.Session.ID].RevokedAt)
	assert.Equal(t, repo.users[user.ID].AuthVersion, repo.sessions[current.Session.ID].AuthVersion)
	assert.NoError(t, bcrypt.CompareHashAndPassword([]byte(repo.users[user.ID].PasswordHash), []byte("password2")))
	require.NoError(t, service.ValidateActiveSession(context.Background(), user.ID, current.Session.ID))
}

func TestRecoveryCodesReturnedOnceAndResetRevokesAll(t *testing.T) {
	service, repo, _ := newTestService(t)
	user := addTestUser(t, repo, "recover@example.com", "+9779811111117", "password1")
	login, err := service.Login(context.Background(), &models.LoginRequest{Email: user.Email, Password: "password1"}, ClientInfo{})
	require.NoError(t, err)
	codes, err := service.RegenerateRecoveryCodes(context.Background(), user.ID, login.Session.ID, "password1", ClientInfo{})
	require.NoError(t, err)
	require.Len(t, codes, recoveryCodeCount)
	assert.Len(t, repo.recovery[user.ID], recoveryCodeCount)
	assert.NotEqual(t, codes[0], repo.recovery[user.ID][0].CodeHash)
	assert.NoError(t, bcrypt.CompareHashAndPassword([]byte(repo.recovery[user.ID][0].CodeHash), []byte(canonicalRecoveryCode(codes[0]))))

	err = service.ResetPasswordWithRecoveryCode(context.Background(), &RecoveryCodeResetRequest{
		Email: user.Email, RecoveryCode: strings.ToLower(codes[0]), NewPassword: "recovered2",
	}, ClientInfo{})
	require.NoError(t, err)
	assert.NotNil(t, repo.sessions[login.Session.ID].RevokedAt)
	assert.NoError(t, bcrypt.CompareHashAndPassword([]byte(repo.users[user.ID].PasswordHash), []byte("recovered2")))

	err = service.ResetPasswordWithRecoveryCode(context.Background(), &RecoveryCodeResetRequest{
		Email: user.Email, RecoveryCode: codes[0], NewPassword: "recovered3",
	}, ClientInfo{})
	assertAppError(t, err, 401, errCodeInvalidRecoveryCode)
}

func TestProfileUpdateIsNarrowValidatedAndPhoneProtected(t *testing.T) {
	service, repo, _ := newTestService(t)
	user := addTestUser(t, repo, "profile@example.com", "+9779811111118", "password1")
	other := addTestUser(t, repo, "taken@example.com", "+9779800000000", "password1")
	firstName := "  Nima "
	phone := "986 123 4567"
	updated, err := service.UpdateProfile(context.Background(), user.ID, &UpdateProfileRequest{
		FirstName: &firstName, PhoneNumber: &phone, CurrentPassword: "password1",
	})
	require.NoError(t, err)
	assert.Equal(t, "Nima", updated.FirstName)
	assert.Equal(t, "+9779861234567", updated.PhoneNumber)
	assert.Equal(t, models.RoleRider, updated.Role)
	assert.Equal(t, models.AccountStatusActive, updated.AccountStatus)

	taken := other.PhoneNumber
	_, err = service.UpdateProfile(context.Background(), user.ID, &UpdateProfileRequest{PhoneNumber: &taken, CurrentPassword: "password1"})
	assertAppError(t, err, 409, errCodePhoneExists)
	newPhone := "9841234567"
	_, err = service.UpdateProfile(context.Background(), user.ID, &UpdateProfileRequest{PhoneNumber: &newPhone, CurrentPassword: "wrong"})
	assertAppError(t, err, 401, common.ErrCodeInvalidCredentials)
}

func TestDeactivateReactivateAndDeleteLifecycle(t *testing.T) {
	service, repo, _ := newTestService(t)
	user := addTestUser(t, repo, "lifecycle@example.com", "+9779811111119", "password1")
	login, err := service.Login(context.Background(), &models.LoginRequest{Email: user.Email, Password: "password1"}, ClientInfo{})
	require.NoError(t, err)
	require.NoError(t, service.DeactivateAccount(context.Background(), user.ID, login.Session.ID, "password1", ClientInfo{}))
	assert.Equal(t, models.AccountStatusDeactivated, repo.users[user.ID].AccountStatus)
	assert.NotNil(t, repo.sessions[login.Session.ID].RevokedAt)

	_, err = service.Login(context.Background(), &models.LoginRequest{Email: user.Email, Password: "password1"}, ClientInfo{})
	assertAppError(t, err, 403, errCodeAccountDeactivated)
	reactivated, err := service.ReactivateAccount(context.Background(), &ReactivateAccountRequest{Email: strings.ToUpper(user.Email), Password: "password1"}, ClientInfo{})
	require.NoError(t, err)
	assert.Equal(t, models.AccountStatusActive, repo.users[user.ID].AccountStatus)
	require.NoError(t, service.ValidateActiveSession(context.Background(), user.ID, reactivated.Session.ID))

	require.NoError(t, service.DeleteAccount(context.Background(), user.ID, reactivated.Session.ID, "password1", ClientInfo{IPAddress: "10.2.3.4", UserAgent: "secret-device"}))
	deleted := repo.users[user.ID]
	assert.Equal(t, models.AccountStatusDeleted, deleted.AccountStatus)
	assert.Equal(t, "Deleted", deleted.FirstName)
	assert.Equal(t, "User", deleted.LastName)
	assert.NotEqual(t, user.Email, deleted.Email)
	assert.NotEqual(t, user.PhoneNumber, deleted.PhoneNumber)
	assert.NotNil(t, deleted.DeletedAt)
	assert.NotNil(t, repo.sessions[reactivated.Session.ID].RevokedAt)
	lastAudit := repo.audits[len(repo.audits)-1]
	assert.Equal(t, "account_deleted", lastAudit.EventType)
	assert.Nil(t, lastAudit.IPAddress)
	assert.Nil(t, lastAudit.UserAgent)
}

func newTestService(t *testing.T) (*Service, *fakeRepository, *jwtkeys.Manager) {
	t.Helper()
	manager, err := jwtkeys.NewManager(context.Background(), jwtkeys.Config{LegacySecret: "unit-test-secret"})
	require.NoError(t, err)
	repo := newFakeRepository()
	service := NewService(repo, manager, zap.NewNop())
	service.now = func() time.Time { return testNow }
	service.passwordCost = bcrypt.MinCost
	return service, repo, manager
}

func addTestUser(t *testing.T, repo *fakeRepository, email, phone, password string) *models.User {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	require.NoError(t, err)
	user := &models.User{
		ID:            uuid.New(),
		Email:         email,
		PhoneNumber:   phone,
		PasswordHash:  string(hash),
		FirstName:     "Test",
		LastName:      "Rider",
		Role:          models.RoleRider,
		IsActive:      true,
		AccountStatus: models.AccountStatusActive,
		AuthVersion:   1,
		CreatedAt:     testNow,
		UpdatedAt:     testNow,
	}
	repo.users[user.ID] = cloneUser(user)
	return cloneUser(user)
}

func parseAccessToken(t *testing.T, manager *jwtkeys.Manager, raw string) *middleware.Claims {
	t.Helper()
	token, err := jwt.ParseWithClaims(raw, &middleware.Claims{}, func(token *jwt.Token) (interface{}, error) {
		kid, _ := token.Header["kid"].(string)
		return manager.ResolveKey(kid)
	},
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithIssuer(middleware.AccessTokenIssuer),
		jwt.WithAudience(middleware.AccessTokenAudience),
		jwt.WithTimeFunc(func() time.Time { return testNow }),
	)
	require.NoError(t, err)
	require.True(t, token.Valid)
	claims, ok := token.Claims.(*middleware.Claims)
	require.True(t, ok)
	return claims
}

func assertAppError(t *testing.T, err error, status int, code string) {
	t.Helper()
	require.Error(t, err)
	var appErr *common.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, status, appErr.Code)
	assert.Equal(t, code, appErr.ErrorCode)
}

func cloneUser(user *models.User) *models.User {
	if user == nil {
		return nil
	}
	copy := *user
	return &copy
}

func cloneSession(session *AuthSession) *AuthSession {
	if session == nil {
		return nil
	}
	copy := *session
	return &copy
}

func cloneCodes(codes []*AccountRecoveryCode) []*AccountRecoveryCode {
	result := make([]*AccountRecoveryCode, 0, len(codes))
	for _, code := range codes {
		copy := *code
		result = append(result, &copy)
	}
	return result
}

func timePointer(value time.Time) *time.Time {
	return &value
}

func stringPointer(value string) *string {
	return &value
}
