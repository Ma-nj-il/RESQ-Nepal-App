package jwtkeys

import (
	"context"
	"encoding/base64"
	"errors"
	"sync"
	"time"
)

var (
	ErrKeyNotFound = errors.New("jwtkeys: signing key not found")
	errNoActiveKey = errors.New("jwtkeys: no active signing key available")
	errReadOnly    = errors.New("jwtkeys: manager is read-only")
)

type Manager struct {
	mu               sync.RWMutex
	store            Store
	keys             map[string]*SigningKey
	activeID         string
	rotationInterval time.Duration
	gracePeriod      time.Duration
	legacySecret     []byte
	readOnly         bool
}

func NewManager(ctx context.Context, cfg Config) (*Manager, error) {
	if cfg.RotationInterval <= 0 {
		cfg.RotationInterval = 30 * 24 * time.Hour
	}
	if cfg.GracePeriod <= 0 {
		cfg.GracePeriod = 30 * 24 * time.Hour
	}

	var store Store
	switch {
	case cfg.Store != nil:
		store = cfg.Store
	case cfg.KeyFilePath == "":
		store = newMemoryStore()
	default:
		store = &fileStore{path: cfg.KeyFilePath}
	}

	manager := &Manager{
		store:            store,
		keys:             make(map[string]*SigningKey),
		rotationInterval: cfg.RotationInterval,
		gracePeriod:      cfg.GracePeriod,
		legacySecret:     []byte(cfg.LegacySecret),
		readOnly:         cfg.ReadOnly,
	}

	if err := manager.reloadFromStore(ctx); err != nil {
		return nil, err
	}

	if manager.activeID == "" && !manager.readOnly {
		if err := manager.seedInitialKey(ctx); err != nil {
			return nil, err
		}
	}

	return manager, nil
}

func (m *Manager) EnsureRotation(ctx context.Context) error {
	if m.readOnly {
		return nil
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	return m.ensureRotationLocked(ctx, time.Now())
}

func (m *Manager) CurrentSigningKey() (*SigningKey, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	key, ok := m.keys[m.activeID]
	if !ok {
		return nil, errNoActiveKey
	}

	return key.Clone(), nil
}

func (m *Manager) ResolveKey(kid string) ([]byte, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if kid == "" {
		return nil, ErrKeyNotFound
	}

	key, ok := m.keys[kid]
	if !ok || key.Revoked || time.Now().After(key.ExpiresAt) {
		return nil, ErrKeyNotFound
	}

	return key.SecretBytes()
}

func (m *Manager) LegacyKey() []byte {
	return m.legacySecret
}

func (m *Manager) StartAutoRotation(ctx context.Context) {
	if m.readOnly {
		return
	}

	interval := m.rotationInterval / 4
	if interval <= 0 {
		interval = time.Hour
	}

	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				_ = m.EnsureRotation(ctx)
			case <-ctx.Done():
				return
			}
		}
	}()
}

func (m *Manager) StartAutoRefresh(ctx context.Context, interval time.Duration) {
	go func() {
		if interval <= 0 {
			interval = 5 * time.Minute
		}
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				_ = m.reloadFromStore(ctx)
			case <-ctx.Done():
				return
			}
		}
	}()
}

func (m *Manager) reloadFromStore(ctx context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	keys, err := m.store.Load(ctx)
	if err != nil {
		return err
	}

	if len(keys) == 0 {
		return nil
	}

	m.keys = make(map[string]*SigningKey, len(keys))
	var latestKey *SigningKey
	for i := range keys {
		key := keys[i]
		m.keys[key.ID] = key.Clone()
		if key.Revoked {
			continue
		}
		if latestKey == nil || key.CreatedAt.After(latestKey.CreatedAt) {
			latestKey = &key
		}
	}

	if latestKey != nil {
		m.activeID = latestKey.ID
	}

	return nil
}

func (m *Manager) seedInitialKey(ctx context.Context) error {
	if m.readOnly {
		return nil
	}

	secret := m.legacySecret
	if len(secret) == 0 {
		randomSecret, err := generateSecret()
		if err != nil {
			return err
		}
		secret = randomSecret
	}

	now := time.Now()
	key := &SigningKey{
		ID:        generateKeyID(now),
		Secret:    base64.StdEncoding.EncodeToString(secret),
		CreatedAt: now,
		ExpiresAt: now.Add(m.rotationInterval + m.gracePeriod),
	}
	m.keys[key.ID] = key
	m.activeID = key.ID
	return m.persistLocked(ctx)
}

func (m *Manager) ensureRotationLocked(ctx context.Context, now time.Time) error {
	key := m.keys[m.activeID]
	if key == nil || now.Sub(key.CreatedAt) >= m.rotationInterval {
		if err := m.rotateLocked(ctx, now); err != nil {
			return err
		}
	}
	return m.pruneExpiredLocked(ctx, now)
}

func (m *Manager) rotateLocked(ctx context.Context, now time.Time) error {
	if m.readOnly {
		return errReadOnly
	}

	rawSecret, err := generateSecret()
	if err != nil {
		return err
	}

	key := &SigningKey{
		ID:        generateKeyID(now),
		Secret:    base64.StdEncoding.EncodeToString(rawSecret),
		CreatedAt: now,
		ExpiresAt: now.Add(m.rotationInterval + m.gracePeriod),
	}

	m.keys[key.ID] = key
	m.activeID = key.ID

	return m.persistLocked(ctx)
}

func (m *Manager) pruneExpiredLocked(ctx context.Context, now time.Time) error {
	if m.readOnly {
		return nil
	}

	changed := false
	for id, key := range m.keys {
		if key.Revoked || now.After(key.ExpiresAt) {
			delete(m.keys, id)
			if id == m.activeID {
				m.activeID = ""
			}
			changed = true
		}
	}

	if !changed {
		return nil
	}

	if m.activeID == "" {
		for id, key := range m.keys {
			if !key.Revoked {
				m.activeID = id
				break
			}
		}
	}

	return m.persistLocked(ctx)
}

func (m *Manager) persistLocked(ctx context.Context) error {
	if m.readOnly {
		return nil
	}

	keys := make([]SigningKey, 0, len(m.keys))
	for _, key := range m.keys {
		keys = append(keys, *key.Clone())
	}
	return m.store.Save(ctx, keys)
}
