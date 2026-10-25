package jwtkeys

import (
	"context"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/config"
)

func NewManagerFromConfig(ctx context.Context, cfg config.JWTConfig, readOnly bool) (*Manager, error) {
	managerCfg := Config{
		KeyFilePath:      cfg.KeyFile,
		RotationInterval: time.Duration(cfg.RotationHours) * time.Hour,
		GracePeriod:      time.Duration(cfg.GraceHours) * time.Hour,
		LegacySecret:     cfg.Secret,
		ReadOnly:         readOnly,
	}
	return NewManager(ctx, managerCfg)
}
