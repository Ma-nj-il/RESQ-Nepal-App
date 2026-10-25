package auth

import (
	"context"
	"fmt"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/common"
	"github.com/bikky-kc013/medi-ambulance/pkg/jwtkeys"
	"github.com/bikky-kc013/medi-ambulance/pkg/middleware"
	"github.com/bikky-kc013/medi-ambulance/pkg/models"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"
)

type Service struct {
	repo       RepositoryInterface
	keyManager *jwtkeys.Manager
	jwtExpiry  int
	logger     *zap.Logger
}

func NewService(
	repo RepositoryInterface,
	keyManager *jwtkeys.Manager,
	jwtExpiry int,
	logger *zap.Logger,
) *Service {
	return &Service{
		repo:       repo,
		keyManager: keyManager,
		jwtExpiry:  jwtExpiry,
		logger:     logger,
	}
}

func (s *Service) Register(ctx context.Context, req *models.RegisterRequest) (*models.User, error) {

	s.logger.Info("register attempt",
		zap.String("email", req.Email),
		zap.String("role", string(req.Role)),
	)

	existingUser, _ := s.repo.GetUserByEmail(ctx, req.Email)
	if existingUser != nil {
		s.logger.Warn("user already exists",
			zap.String("email", req.Email),
		)
		return nil, common.NewConflictError("user with this email already exists")
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		s.logger.Error("password hashing failed",
			zap.String("email", req.Email),
			zap.Error(err),
		)
		return nil, common.NewInternalServerError("failed to hash password")
	}

	user := &models.User{
		ID:           uuid.New(),
		Email:        req.Email,
		PhoneNumber:  req.PhoneNumber,
		PasswordHash: string(hashedPassword),
		FirstName:    req.FirstName,
		LastName:     req.LastName,
		Role:         req.Role,
		IsActive:     true,
		IsVerified:   false,
	}

	if err := s.repo.CreateUser(ctx, user); err != nil {
		s.logger.Error("failed to create user",
			zap.String("email", req.Email),
			zap.Error(err),
		)
		return nil, common.NewInternalServerError("failed to create user")
	}

	s.logger.Info("user registered successfully",
		zap.String("user_id", user.ID.String()),
		zap.String("role", string(user.Role)),
	)

	user.PasswordHash = ""
	return user, nil
}

func (s *Service) RegisterDriver(ctx context.Context, req *models.RegisterRequest, driver *models.Driver) (*models.User, error) {

	user, err := s.Register(ctx, req)
	if err != nil {
		return nil, err
	}

	driver.ID = uuid.New()
	driver.UserID = user.ID
	driver.IsAvailable = false
	driver.IsOnline = false
	driver.Rating = 0.0
	driver.TotalRides = 0

	if err := s.repo.CreateDriver(ctx, driver); err != nil {
		s.logger.Error("failed to create driver profile",
			zap.String("user_id", user.ID.String()),
			zap.Error(err),
		)
		return nil, common.NewInternalServerError("failed to create driver profile")
	}

	s.logger.Info("driver profile created",
		zap.String("user_id", user.ID.String()),
		zap.String("driver_id", driver.ID.String()),
	)

	return user, nil
}

func (s *Service) Login(ctx context.Context, req *models.LoginRequest) (*models.LoginResponse, error) {

	s.logger.Info("login attempt",
		zap.String("email", req.Email),
	)

	user, err := s.repo.GetUserByEmail(ctx, req.Email)
	if err != nil {
		s.logger.Warn("invalid login attempt",
			zap.String("email", req.Email),
			zap.Error(err),
		)
		return nil, common.NewUnauthorizedError("invalid credentials")
	}

	if !user.IsActive {
		s.logger.Warn("inactive account login attempt",
			zap.String("user_id", user.ID.String()),
		)
		return nil, common.NewUnauthorizedError("account is inactive")
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		s.logger.Warn("wrong password",
			zap.String("email", req.Email),
		)
		return nil, common.NewUnauthorizedError("invalid credentials")
	}

	token, err := s.generateToken(ctx, user)
	if err != nil {
		s.logger.Error("token generation failed",
			zap.String("user_id", user.ID.String()),
			zap.Error(err),
		)
		return nil, common.NewInternalServerError("failed to generate token")
	}

	s.logger.Info("login successful",
		zap.String("user_id", user.ID.String()),
	)

	user.PasswordHash = ""

	return &models.LoginResponse{
		User:  user,
		Token: token,
	}, nil
}

func (s *Service) GetProfile(ctx context.Context, userID uuid.UUID) (*models.User, error) {

	user, err := s.repo.GetUserByID(ctx, userID)
	if err != nil {
		s.logger.Warn("user not found",
			zap.String("user_id", userID.String()),
			zap.Error(err),
		)
		return nil, common.NewNotFoundError("user not found", nil)
	}

	user.PasswordHash = ""
	return user, nil
}

func (s *Service) UpdateProfile(ctx context.Context, userID uuid.UUID, updates *models.User) (*models.User, error) {

	user, err := s.repo.GetUserByID(ctx, userID)
	if err != nil {
		s.logger.Warn("user not found",
			zap.String("user_id", userID.String()),
			zap.Error(err),
		)
		return nil, common.NewNotFoundError("user not found", nil)
	}

	if updates.FirstName != "" {
		user.FirstName = updates.FirstName
	}
	if updates.LastName != "" {
		user.LastName = updates.LastName
	}
	if updates.PhoneNumber != "" {
		user.PhoneNumber = updates.PhoneNumber
	}
	if updates.ProfileImage != nil {
		user.ProfileImage = updates.ProfileImage
	}

	if err := s.repo.UpdateUser(ctx, user); err != nil {
		s.logger.Error("failed to update profile",
			zap.String("user_id", user.ID.String()),
			zap.Error(err),
		)
		return nil, common.NewInternalServerError("failed to update profile")
	}

	s.logger.Info("profile updated",
		zap.String("user_id", user.ID.String()),
	)

	user.PasswordHash = ""
	return user, nil
}

func (s *Service) generateToken(ctx context.Context, user *models.User) (string, error) {

	if s.keyManager == nil {
		s.logger.Error("jwt key manager not configured")
		return "", fmt.Errorf("jwt key manager is not configured")
	}

	if err := s.keyManager.EnsureRotation(ctx); err != nil {
		s.logger.Error("failed to rotate signing key",
			zap.Error(err),
		)
		return "", fmt.Errorf("failed to rotate signing key: %w", err)
	}

	key, err := s.keyManager.CurrentSigningKey()
	if err != nil {
		s.logger.Error("failed to retrieve signing key",
			zap.Error(err),
		)
		return "", fmt.Errorf("failed to retrieve signing key: %w", err)
	}

	secretBytes, err := key.SecretBytes()
	if err != nil {
		s.logger.Error("invalid signing key",
			zap.Error(err),
		)
		return "", fmt.Errorf("invalid signing key: %w", err)
	}

	claims := &middleware.Claims{
		UserID: user.ID,
		Email:  user.Email,
		Role:   user.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour * time.Duration(s.jwtExpiry))),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	token.Header["kid"] = key.ID

	tokenString, err := token.SignedString(secretBytes)
	if err != nil {
		s.logger.Error("failed to sign token",
			zap.String("user_id", user.ID.String()),
			zap.Error(err),
		)
		return "", fmt.Errorf("failed to sign token: %w", err)
	}

	return tokenString, nil
}
