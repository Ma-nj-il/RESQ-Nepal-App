package database

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/config"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type DBPool struct {
	Primary  *gorm.DB
	Replicas []*gorm.DB
	mu       sync.RWMutex
	rrIndex  int
}

func NewDBPool(cfg *config.DatabaseConfig, replicaDSNs []string, queryTimeoutSeconds ...int) (*DBPool, error) {
	timeout := resolveQueryTimeout(queryTimeoutSeconds...)

	primary, err := newGormDB(cfg.DSN(), cfg.MaxConns, cfg.MinConns, time.Hour, timeout)
	if err != nil {
		return nil, fmt.Errorf("failed to create primary DB: %w", err)
	}

	dbPool := &DBPool{
		Primary:  primary,
		Replicas: make([]*gorm.DB, 0, len(replicaDSNs)),
	}

	for i, dsn := range replicaDSNs {
		if dsn == "" {
			continue
		}

		replica, err := newGormDB(dsn, cfg.MaxConns, cfg.MinConns, time.Hour, timeout)
		if err != nil {
			return nil, fmt.Errorf("failed to create replica %d: %w", i, err)
		}

		dbPool.Replicas = append(dbPool.Replicas, replica)
	}

	return dbPool, nil
}

func newGormDB(dsn string, maxOpen, maxIdle int, connMaxLifetime time.Duration, statementTimeout int) (*gorm.DB, error) {
	fmt.Printf("%+v\n", dsn)
	gdb, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
	if err != nil {
		return nil, err
	}

	sqlDB, err := gdb.DB()
	if err != nil {
		return nil, err
	}

	sqlDB.SetMaxOpenConns(maxOpen)
	sqlDB.SetMaxIdleConns(maxIdle)
	sqlDB.SetConnMaxLifetime(connMaxLifetime)

	if statementTimeout > 0 {
		if err := sqlDB.Ping(); err == nil {
			_, _ = sqlDB.Exec(fmt.Sprintf("SET statement_timeout = %d", statementTimeout*1000))
		}
	}

	return gdb, nil
}

func (p *DBPool) GetReplica() *gorm.DB {
	p.mu.Lock()
	defer p.mu.Unlock()

	if len(p.Replicas) == 0 {
		return p.Primary
	}

	replica := p.Replicas[p.rrIndex]
	p.rrIndex = (p.rrIndex + 1) % len(p.Replicas)
	return replica
}

func (p *DBPool) GetPrimary() *gorm.DB {
	return p.Primary
}

func (p *DBPool) Close() {
	if p.Primary != nil {
		sqlDB, _ := p.Primary.DB()
		sqlDB.Close()
	}

	p.mu.Lock()
	defer p.mu.Unlock()

	for _, replica := range p.Replicas {
		if replica != nil {
			sqlDB, _ := replica.DB()
			sqlDB.Close()
		}
	}
}

func (p *DBPool) Ping(ctx context.Context) error {
	if p.Primary == nil {
		return fmt.Errorf("primary database connection is nil")
	}

	sqlDB, err := p.Primary.DB()
	if err != nil {
		return fmt.Errorf("failed to get sql.DB: %w", err)
	}

	return sqlDB.PingContext(ctx)
}

func Init(dsn string) (*DBPool, error) {
	primary, err := newGormDB(dsn, 10, 2, time.Hour, 0)
	if err != nil {
		return nil, fmt.Errorf("failed to init DB: %w", err)
	}

	return &DBPool{
		Primary:  primary,
		Replicas: make([]*gorm.DB, 0),
	}, nil
}

func NewPostgresPool(cfg *config.DatabaseConfig, queryTimeoutSeconds int) (*DBPool, error) {
	return NewDBPool(cfg, nil, queryTimeoutSeconds)
}

func resolveQueryTimeout(queryTimeoutSeconds ...int) int {
	timeout := config.DefaultDatabaseQueryTimeout
	if len(queryTimeoutSeconds) > 0 && queryTimeoutSeconds[0] > 0 {
		timeout = queryTimeoutSeconds[0]
	}
	return timeout
}
