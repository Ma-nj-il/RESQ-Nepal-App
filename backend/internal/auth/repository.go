package auth

import (
	"context"
	"fmt"

	"github.com/bikky-kc013/medi-ambulance/pkg/database"
	"github.com/bikky-kc013/medi-ambulance/pkg/models"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Repository struct {
	db *database.DBPool
}

func NewRepository(db *database.DBPool) *Repository {
	return &Repository{db: db}
}

func (r *Repository) CreateUser(ctx context.Context, user *models.User) error {
	return r.db.Primary.WithContext(ctx).Transaction(func(tx *gorm.DB) error {

		if err := tx.Create(user).Error; err != nil {
			return err
		}
		return nil
	})
}

func (r *Repository) CreateDriver(ctx context.Context, driver *models.Driver) error {
	if err := r.db.Primary.WithContext(ctx).Create(driver).Error; err != nil {
		return fmt.Errorf("failed to create driver: %w", err)
	}

	return nil
}

func (r *Repository) GetUserByEmail(ctx context.Context, email string) (*models.User, error) {
	var user models.User
	err := r.db.Primary.WithContext(ctx).Where("email = ?", email).First(&user).Error
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *Repository) GetUserByID(ctx context.Context, id uuid.UUID) (*models.User, error) {
	var user models.User
	err := r.db.Primary.WithContext(ctx).First(&user, "id = ?", id).Error
	if err != nil {
		return nil, fmt.Errorf("failed to get user by id: %w", err)
	}

	return &user, nil
}

func (r *Repository) UpdateUser(ctx context.Context, user *models.User) error {
	err := r.db.Primary.WithContext(ctx).Model(user).Select("FirstName", "LastName", "PhoneNumber", "ProfileImage", "UpdatedAt").Updates(user).Error
	if err != nil {
		return fmt.Errorf("failed to update user: %w", err)
	}

	return nil
}
