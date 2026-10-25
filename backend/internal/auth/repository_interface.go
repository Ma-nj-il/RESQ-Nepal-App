package auth

import (
	"context"

	"github.com/bikky-kc013/medi-ambulance/pkg/models"
	"github.com/google/uuid"
)

type RepositoryInterface interface {
	CreateUser(ctx context.Context, user *models.User) error
	CreateDriver(ctx context.Context, driver *models.Driver) error
	GetUserByEmail(ctx context.Context, email string) (*models.User, error)
	GetUserByID(ctx context.Context, id uuid.UUID) (*models.User, error)
	UpdateUser(ctx context.Context, user *models.User) error
}
