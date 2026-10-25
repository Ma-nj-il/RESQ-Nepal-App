package secrets

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	"go.uber.org/zap"
)

type ProviderType string

const (
	ProviderNone       ProviderType = ""
	ProviderAWS        ProviderType = "aws"
	ProviderGCP        ProviderType = "gcp"
	ProviderKubernetes ProviderType = "kubernetes"
)

type SecretType string

const (
	SecretDatabase SecretType = "database_credentials"
	SecretJWTKeys  SecretType = "jwt_signing_keys"
	SecretFirebase SecretType = "firebase_credentials"
	SecretTwilio   SecretType = "twilio_credentials"
	SecretSMTP     SecretType = "smtp_credentials"
	SecretCustom   SecretType = "custom"
)

var (
	ErrProviderNotConfigured = errors.New("secrets: provider not configured")
	ErrInvalidReference      = errors.New("secrets: invalid reference")
	ErrKeyNotFound           = errors.New("secrets: key not found")
)

type Reference struct {
	Name     string
	Path     string
	Mount    string
	Key      string
	Version  string
	Provider ProviderType
	Type     SecretType
	raw      string
}

func (r Reference) CacheKey() string {
	sb := strings.Builder{}
	if r.Mount != "" {
		sb.WriteString(r.Mount)
		sb.WriteString("|")
	}
	sb.WriteString(r.Path)
	if r.Version != "" {
		sb.WriteString("@")
		sb.WriteString(r.Version)
	}
	if r.Key != "" {
		sb.WriteString("#")
		sb.WriteString(r.Key)
	}
	return sb.String()
}

func ParseReference(name string, secretType SecretType, raw string) (Reference, error) {
	ref := Reference{
		Name: name,
		Type: secretType,
		raw:  raw,
	}

	clean := strings.TrimSpace(raw)
	if clean == "" {
		return ref, ErrInvalidReference
	}

	if idx := strings.Index(clean, "://"); idx > 0 {
		ref.Provider = ProviderType(clean[:idx])
		clean = clean[idx+3:]
	}

	if idx := strings.Index(clean, "#"); idx >= 0 {
		ref.Key = strings.TrimSpace(clean[idx+1:])
		clean = strings.TrimSpace(clean[:idx])
	}

	if idx := strings.Index(clean, "@"); idx >= 0 {
		ref.Version = strings.TrimSpace(clean[idx+1:])
		clean = strings.TrimSpace(clean[:idx])
	}

	pathPart := strings.Trim(clean, "/")
	ref.Path = pathPart

	if idx := strings.Index(pathPart, "::"); idx >= 0 {
		ref.Mount = strings.TrimSpace(pathPart[:idx])
		ref.Path = strings.Trim(pathPart[idx+2:], "/")
	} else if idx := strings.Index(pathPart, ":"); idx >= 0 {
		candidate := strings.TrimSpace(pathPart[:idx])
		remainder := strings.Trim(pathPart[idx+1:], "/")
		if candidate != "" && !strings.Contains(candidate, "/") && remainder != "" {
			ref.Mount = candidate
			ref.Path = remainder
		}
	}

	ref.Path = strings.Trim(ref.Path, "/")
	if ref.Path == "" {
		return ref, ErrInvalidReference
	}

	return ref, nil
}

type Metadata struct {
	Version     string
	CreatedAt   time.Time
	UpdatedAt   time.Time
	RetrievedAt time.Time
	RotateAfter time.Time
}

type Secret struct {
	Data     map[string]string
	Metadata Metadata
}

func (s Secret) Value(key string) (string, bool) {
	if s.Data == nil {
		return "", false
	}
	val, ok := s.Data[key]
	return val, ok && val != ""
}

type Config struct {
	Provider         ProviderType
	CacheTTL         time.Duration
	RotationInterval time.Duration
	AuditEnabled     bool
	AWS              AWSConfig
	GCP              GCPConfig
	Kubernetes       KubernetesConfig
}

type Manager interface {
	GetSecret(ctx context.Context, ref Reference) (Secret, error)
	GetString(ctx context.Context, ref Reference) (string, error)
	Close() error
}

type provider interface {
	Name() ProviderType
	Fetch(ctx context.Context, ref Reference) (Secret, error)
	Close() error
}

type manager struct {
	provider         provider
	cacheTTL         time.Duration
	rotationInterval time.Duration
	auditEnabled     bool

	mu    sync.RWMutex
	cache map[string]cachedSecret
}

type cachedSecret struct {
	secret    Secret
	expiresAt time.Time
}

func NewManager(cfg Config) (Manager, error) {
	if cfg.Provider == ProviderNone {
		return nil, ErrProviderNotConfigured
	}

	var prov provider
	var err error
	ctx := context.Background()

	switch cfg.Provider {
	case ProviderAWS:
		prov, err = newAWSProvider(ctx, cfg.AWS)
	case ProviderGCP:
		prov, err = newGCPProvider(ctx, cfg.GCP)
	case ProviderKubernetes:
		prov, err = newKubernetesProvider(cfg.Kubernetes)
	default:
		err = fmt.Errorf("secrets: unsupported provider %q", cfg.Provider)
	}

	if err != nil {
		return nil, err
	}

	if cfg.CacheTTL <= 0 {
		cfg.CacheTTL = 5 * time.Minute
	}

	if cfg.RotationInterval <= 0 {
		cfg.RotationInterval = 90 * 24 * time.Hour
	}

	return &manager{
		provider:         prov,
		cacheTTL:         cfg.CacheTTL,
		rotationInterval: cfg.RotationInterval,
		auditEnabled:     cfg.AuditEnabled,
		cache:            make(map[string]cachedSecret),
	}, nil
}

func (m *manager) Close() error {
	if m.provider != nil {
		return m.provider.Close()
	}
	return nil
}

func (m *manager) GetSecret(ctx context.Context, ref Reference) (Secret, error) {
	if err := m.validateRef(ref); err != nil {
		return Secret{}, err
	}

	if secret, ok := m.loadFromCache(ref); ok {
		return secret, nil
	}

	secret, err := m.provider.Fetch(ctx, ref)
	if err != nil {
		m.audit(ref, Metadata{}, err)
		return Secret{}, err
	}

	now := time.Now().UTC()
	secret.Metadata.RetrievedAt = now
	if secret.Metadata.RotateAfter.IsZero() && m.rotationInterval > 0 {
		base := secret.Metadata.UpdatedAt
		if base.IsZero() {
			base = secret.Metadata.CreatedAt
		}
		if base.IsZero() {
			base = now
		}
		secret.Metadata.RotateAfter = base.Add(m.rotationInterval)
	}

	m.saveToCache(ref, secret)
	m.audit(ref, secret.Metadata, nil)

	if !secret.Metadata.RotateAfter.IsZero() && now.After(secret.Metadata.RotateAfter) {
		logger.Warn("secret rotation overdue",
			zap.String("secret_name", ref.Name),
			zap.String("secret_type", string(ref.Type)),
			zap.Time("last_updated_at", secret.Metadata.UpdatedAt),
			zap.Time("rotate_after", secret.Metadata.RotateAfter))
	}

	return secret, nil
}

func (m *manager) GetString(ctx context.Context, ref Reference) (string, error) {
	if ref.Key == "" {
		return "", fmt.Errorf("%w: empty key in reference %q", ErrKeyNotFound, ref.Name)
	}

	secret, err := m.GetSecret(ctx, ref)
	if err != nil {
		return "", err
	}

	if value, ok := secret.Value(ref.Key); ok {
		return value, nil
	}

	return "", fmt.Errorf("%w: %s", ErrKeyNotFound, ref.Key)
}

func (m *manager) validateRef(ref Reference) error {
	if ref.Path == "" {
		return ErrInvalidReference
	}
	if ref.Provider != ProviderNone && ref.Provider != m.provider.Name() {
		return fmt.Errorf("secrets: reference provider %q does not match manager provider %q", ref.Provider, m.provider.Name())
	}
	return nil
}

func (m *manager) loadFromCache(ref Reference) (Secret, bool) {
	m.mu.RLock()
	entry, ok := m.cache[ref.CacheKey()]
	m.mu.RUnlock()
	if !ok || time.Now().After(entry.expiresAt) {
		return Secret{}, false
	}
	return cloneSecret(entry.secret), true
}

func (m *manager) saveToCache(ref Reference, secret Secret) {
	if m.cacheTTL <= 0 {
		return
	}
	m.mu.Lock()
	m.cache[ref.CacheKey()] = cachedSecret{
		secret:    cloneSecret(secret),
		expiresAt: time.Now().Add(m.cacheTTL),
	}
	m.mu.Unlock()
}

func (m *manager) audit(ref Reference, metadata Metadata, err error) {
	if !m.auditEnabled {
		return
	}

	fields := []zap.Field{
		zap.String("secret_name", ref.Name),
		zap.String("secret_path", ref.Path),
		zap.String("secret_type", string(ref.Type)),
		zap.String("provider", string(m.provider.Name())),
	}

	if metadata.Version != "" {
		fields = append(fields, zap.String("version", metadata.Version))
	}

	if !metadata.RetrievedAt.IsZero() {
		fields = append(fields, zap.Time("retrieved_at", metadata.RetrievedAt))
	}

	if err != nil {
		logger.Warn("secret fetch failed", append(fields, zap.Error(err))...)
		return
	}

	logger.Info("secret fetched", fields...)
}

func cloneSecret(src Secret) Secret {
	dst := Secret{
		Data:     make(map[string]string, len(src.Data)),
		Metadata: src.Metadata,
	}

	for k, v := range src.Data {
		dst.Data[k] = v
	}

	return dst
}
