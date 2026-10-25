package admin

import (
	"time"

	"github.com/google/uuid"
)

type AuditLog struct {
	ID         uuid.UUID              `json:"id" gorm:"primaryKey;type:uuid"`
	AdminID    uuid.UUID              `json:"admin_id" gorm:"type:uuid;not null"`
	Action     string                 `json:"action" gorm:"not null"`
	TargetType string                 `json:"target_type" gorm:"not null"`
	TargetID   uuid.UUID              `json:"target_id" gorm:"type:uuid;not null"`
	Metadata   map[string]interface{} `json:"metadata" gorm:"type:jsonb"`
	CreatedAt  time.Time              `json:"created_at" gorm:"not null;default:now()"`
	AdminName  string                 `json:"admin_name" gorm:"->"`
}
