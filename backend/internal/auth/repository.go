package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/database"
	"github.com/bikky-kc013/medi-ambulance/pkg/models"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

type Repository struct {
	db *database.DBPool
}

func NewRepository(db *database.DBPool) *Repository {
	return &Repository{db: db}
}

func (r *Repository) query(ctx context.Context) *gorm.DB {
	return r.db.Primary.Session(&gorm.Session{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	}).WithContext(ctx)
}

func (r *Repository) CreateUser(ctx context.Context, user *models.User) error {
	return mapRepositoryError(r.query(ctx).Create(user).Error)
}

func (r *Repository) GetUserByEmail(ctx context.Context, email string) (*models.User, error) {
	var user models.User
	err := r.query(ctx).
		Where("LOWER(email) = ?", strings.ToLower(email)).
		First(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrUserNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get user by email: %w", err)
	}
	return &user, nil
}

func (r *Repository) GetUserByPhone(ctx context.Context, phone string) (*models.User, error) {
	var user models.User
	err := r.query(ctx).Where(`
		CASE
			WHEN phone_number ~ '^\+9779[678][0-9]{8}$' THEN phone_number
			WHEN phone_number ~ '^9779[678][0-9]{8}$' THEN '+' || phone_number
			WHEN phone_number ~ '^09[678][0-9]{8}$' THEN '+977' || SUBSTRING(phone_number FROM 2)
			WHEN phone_number ~ '^9[678][0-9]{8}$' THEN '+977' || phone_number
			ELSE phone_number
		END = ?
	`, phone).First(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrUserNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get user by phone: %w", err)
	}
	return &user, nil
}

func (r *Repository) GetUserByID(ctx context.Context, id uuid.UUID) (*models.User, error) {
	var user models.User
	err := r.query(ctx).First(&user, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrUserNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get user by id: %w", err)
	}
	return &user, nil
}

func (r *Repository) UpdateProfile(ctx context.Context, userID uuid.UUID, changes ProfileChanges) (*models.User, error) {
	updates := map[string]interface{}{"updated_at": time.Now().UTC()}
	if changes.FirstName != nil {
		updates["first_name"] = *changes.FirstName
	}
	if changes.LastName != nil {
		updates["last_name"] = *changes.LastName
	}
	if changes.PhoneNumber != nil {
		updates["phone_number"] = *changes.PhoneNumber
	}
	if changes.ProfileImage != nil {
		updates["profile_image"] = *changes.ProfileImage
	}

	result := r.query(ctx).Model(&models.User{}).
		Where("id = ? AND account_status = ? AND is_active = TRUE AND deleted_at IS NULL", userID, models.AccountStatusActive).
		Updates(updates)
	if err := mapRepositoryError(result.Error); err != nil {
		return nil, err
	}
	if result.RowsAffected == 0 {
		return nil, ErrUserNotFound
	}
	return r.GetUserByID(ctx, userID)
}

func (r *Repository) CreateSession(ctx context.Context, session *AuthSession) error {
	if err := r.query(ctx).Create(session).Error; err != nil {
		return fmt.Errorf("create auth session: %w", err)
	}
	return nil
}

func (r *Repository) RotateSession(ctx context.Context, currentHash, replacementHash string, usedAt time.Time) (*AuthSession, *models.User, error) {
	var session AuthSession
	var user models.User
	err := r.query(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Raw(`
			SELECT s.*
			FROM auth_sessions AS s
			JOIN users AS u ON u.id = s.user_id
			WHERE s.refresh_token_hash = ?
			  AND s.revoked_at IS NULL
			  AND s.expires_at > ?
			  AND s.auth_version = u.auth_version
			  AND u.account_status = 'active'
			  AND u.is_active = TRUE
			  AND u.deleted_at IS NULL
			FOR UPDATE OF s
		`, currentHash, usedAt).Scan(&session)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrInvalidRefreshToken
		}

		result = tx.Model(&AuthSession{}).
			Where("id = ? AND refresh_token_hash = ?", session.ID, currentHash).
			Updates(map[string]interface{}{
				"refresh_token_hash": replacementHash,
				"last_used_at":       usedAt,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrInvalidRefreshToken
		}
		if err := tx.First(&user, "id = ?", session.UserID).Error; err != nil {
			return err
		}

		session.RefreshTokenHash = replacementHash
		session.LastUsedAt = usedAt
		return nil
	})
	if errors.Is(err, ErrInvalidRefreshToken) {
		return nil, nil, ErrInvalidRefreshToken
	}
	if err != nil {
		return nil, nil, fmt.Errorf("rotate auth session: %w", err)
	}
	return &session, &user, nil
}

func (r *Repository) ValidateSession(ctx context.Context, userID, sessionID uuid.UUID, now time.Time) error {
	var marker int
	result := r.query(ctx).Raw(`
		SELECT 1
		FROM auth_sessions AS s
		JOIN users AS u ON u.id = s.user_id
		WHERE s.id = ?
		  AND s.user_id = ?
		  AND s.revoked_at IS NULL
		  AND s.expires_at > ?
		  AND s.auth_version = u.auth_version
		  AND u.account_status = 'active'
		  AND u.is_active = TRUE
		  AND u.deleted_at IS NULL
	`, sessionID, userID, now).Scan(&marker)
	if result.Error != nil {
		return fmt.Errorf("validate auth session: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return ErrSessionNotFound
	}
	return nil
}

func (r *Repository) ListSessions(ctx context.Context, userID uuid.UUID, now time.Time) ([]*AuthSession, error) {
	var sessions []*AuthSession
	err := r.query(ctx).
		Where("user_id = ? AND revoked_at IS NULL AND expires_at > ?", userID, now).
		Order("last_used_at DESC").
		Find(&sessions).Error
	if err != nil {
		return nil, fmt.Errorf("list auth sessions: %w", err)
	}
	return sessions, nil
}

func (r *Repository) RevokeSession(ctx context.Context, userID, sessionID uuid.UUID, reason string, now time.Time) error {
	result := r.query(ctx).Model(&AuthSession{}).
		Where("id = ? AND user_id = ? AND revoked_at IS NULL", sessionID, userID).
		Updates(map[string]interface{}{
			"revoked_at":        now,
			"revocation_reason": reason,
		})
	if result.Error != nil {
		return fmt.Errorf("revoke auth session: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return ErrSessionNotFound
	}
	return nil
}

func (r *Repository) RevokeAllSessions(ctx context.Context, userID uuid.UUID, reason string, exceptSessionID *uuid.UUID, now time.Time) (int64, error) {
	query := r.query(ctx).Model(&AuthSession{}).
		Where("user_id = ? AND revoked_at IS NULL", userID)
	if exceptSessionID != nil {
		query = query.Where("id <> ?", *exceptSessionID)
	}
	result := query.Updates(map[string]interface{}{
		"revoked_at":        now,
		"revocation_reason": reason,
	})
	if result.Error != nil {
		return 0, fmt.Errorf("revoke all auth sessions: %w", result.Error)
	}
	return result.RowsAffected, nil
}

func (r *Repository) ChangePassword(ctx context.Context, userID, currentSessionID uuid.UUID, passwordHash string, now time.Time) error {
	return r.query(ctx).Transaction(func(tx *gorm.DB) error {
		var authVersion int
		result := tx.Raw(`
			UPDATE users
			SET password_hash = ?, auth_version = auth_version + 1, updated_at = ?
			WHERE id = ? AND account_status = 'active' AND is_active = TRUE AND deleted_at IS NULL
			RETURNING auth_version
		`, passwordHash, now, userID).Scan(&authVersion)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrUserNotFound
		}

		if err := tx.Model(&AuthSession{}).
			Where("user_id = ? AND id <> ? AND revoked_at IS NULL", userID, currentSessionID).
			Updates(map[string]interface{}{
				"revoked_at":        now,
				"revocation_reason": "password_changed",
			}).Error; err != nil {
			return err
		}

		result = tx.Model(&AuthSession{}).
			Where("id = ? AND user_id = ? AND revoked_at IS NULL", currentSessionID, userID).
			Update("auth_version", authVersion)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrSessionNotFound
		}
		return nil
	})
}

func (r *Repository) ReplaceRecoveryCodes(ctx context.Context, userID uuid.UUID, codes []*AccountRecoveryCode) error {
	return r.query(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("user_id = ?", userID).Delete(&AccountRecoveryCode{}).Error; err != nil {
			return err
		}
		if len(codes) == 0 {
			return nil
		}
		return tx.Create(&codes).Error
	})
}

func (r *Repository) GetUnusedRecoveryCodes(ctx context.Context, userID uuid.UUID) ([]*AccountRecoveryCode, error) {
	var codes []*AccountRecoveryCode
	err := r.query(ctx).
		Where("user_id = ? AND used_at IS NULL", userID).
		Order("created_at DESC").
		Find(&codes).Error
	if err != nil {
		return nil, fmt.Errorf("get recovery codes: %w", err)
	}
	return codes, nil
}

func (r *Repository) ResetPasswordWithRecoveryCode(ctx context.Context, userID, codeID uuid.UUID, passwordHash string, now time.Time) error {
	return r.query(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&AccountRecoveryCode{}).
			Where("id = ? AND user_id = ? AND used_at IS NULL", codeID, userID).
			Update("used_at", now)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrRecoveryCodeUsed
		}

		result = tx.Model(&models.User{}).
			Where("id = ? AND account_status = ? AND is_active = TRUE AND deleted_at IS NULL", userID, models.AccountStatusActive).
			Updates(map[string]interface{}{
				"password_hash": passwordHash,
				"auth_version":  gorm.Expr("auth_version + 1"),
				"updated_at":    now,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrInvalidAccountState
		}

		return tx.Model(&AuthSession{}).
			Where("user_id = ? AND revoked_at IS NULL", userID).
			Updates(map[string]interface{}{
				"revoked_at":        now,
				"revocation_reason": "password_recovery",
			}).Error
	})
}

func (r *Repository) DeactivateAccount(ctx context.Context, userID uuid.UUID, now time.Time) error {
	return r.query(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&models.User{}).
			Where("id = ? AND account_status = ? AND is_active = TRUE AND deleted_at IS NULL", userID, models.AccountStatusActive).
			Updates(map[string]interface{}{
				"account_status": models.AccountStatusDeactivated,
				"is_active":      false,
				"auth_version":   gorm.Expr("auth_version + 1"),
				"updated_at":     now,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrInvalidAccountState
		}
		return tx.Model(&AuthSession{}).
			Where("user_id = ? AND revoked_at IS NULL", userID).
			Updates(map[string]interface{}{
				"revoked_at":        now,
				"revocation_reason": "account_deactivated",
			}).Error
	})
}

func (r *Repository) ReactivateAccount(ctx context.Context, userID uuid.UUID, session *AuthSession, now time.Time) error {
	return r.query(ctx).Transaction(func(tx *gorm.DB) error {
		var authVersion int
		result := tx.Raw(`
			UPDATE users
			SET account_status = 'active', is_active = TRUE,
			    auth_version = auth_version + 1, updated_at = ?
			WHERE id = ? AND account_status = 'deactivated' AND is_active = FALSE AND deleted_at IS NULL
			RETURNING auth_version
		`, now, userID).Scan(&authVersion)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrInvalidAccountState
		}
		session.AuthVersion = authVersion
		return tx.Create(session).Error
	})
}

func (r *Repository) DeleteAccount(ctx context.Context, userID uuid.UUID, anonymizedEmail, anonymizedPhone, invalidPasswordHash string, now time.Time) error {
	return r.query(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&models.User{}).
			Where("id = ? AND account_status <> ? AND deleted_at IS NULL", userID, models.AccountStatusDeleted).
			Updates(map[string]interface{}{
				"email":          anonymizedEmail,
				"phone_number":   anonymizedPhone,
				"password_hash":  invalidPasswordHash,
				"first_name":     "Deleted",
				"last_name":      "User",
				"profile_image":  nil,
				"account_status": models.AccountStatusDeleted,
				"is_active":      false,
				"auth_version":   gorm.Expr("auth_version + 1"),
				"deleted_at":     now,
				"updated_at":     now,
			})
		if err := mapRepositoryError(result.Error); err != nil {
			return err
		}
		if result.RowsAffected != 1 {
			return ErrInvalidAccountState
		}

		if err := tx.Model(&AuthSession{}).
			Where("user_id = ?", userID).
			Updates(map[string]interface{}{
				"revoked_at":        now,
				"revocation_reason": "account_deleted",
				"device_name":       nil,
				"ip_address":        nil,
				"user_agent":        nil,
			}).Error; err != nil {
			return err
		}
		if err := tx.Where("user_id = ?", userID).Delete(&AccountRecoveryCode{}).Error; err != nil {
			return err
		}
		return tx.Table("auth_audit_events").Where("user_id = ?", userID).
			Updates(map[string]interface{}{"ip_address": nil, "user_agent": nil}).Error
	})
}

func (r *Repository) CreateAuditEvent(ctx context.Context, event *AuditEvent) error {
	metadata, err := json.Marshal(event.Metadata)
	if err != nil {
		return fmt.Errorf("marshal auth audit metadata: %w", err)
	}
	if event.ID == uuid.Nil {
		event.ID = uuid.New()
	}
	result := r.query(ctx).Exec(`
		INSERT INTO auth_audit_events
			(id, user_id, session_id, event_type, event_status, ip_address, user_agent, metadata)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb)
	`, event.ID, event.UserID, event.SessionID, event.EventType, event.EventStatus, event.IPAddress, event.UserAgent, string(metadata))
	if result.Error != nil {
		return fmt.Errorf("create auth audit event: %w", result.Error)
	}
	return nil
}

func mapRepositoryError(err error) error {
	if err == nil {
		return nil
	}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23505" {
		return err
	}
	constraint := strings.ToLower(pgErr.ConstraintName)
	switch {
	case strings.Contains(constraint, "email"):
		return ErrDuplicateEmail
	case strings.Contains(constraint, "phone"):
		return ErrDuplicatePhone
	default:
		return err
	}
}
