package adapters

import (
	"context"
	"fmt"

	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	"github.com/bikky-kc013/medi-ambulance/pkg/models"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

type StubDriverService struct{}

func (s *StubDriverService) GetDriverByUserID(ctx context.Context, userID uuid.UUID) (*models.Driver, error) {
	logger.Warn("stubDriverService.GetDriverByUserID called — admin endpoints don't require this",
		zap.String("user_id", userID.String()))
	return nil, fmt.Errorf("driver service not configured for admin")
}
