package config

import (
	"context"
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/secrets"
)

type SecretsSettings struct {
	Provider        secrets.ProviderType
	CacheTTLSeconds int
	RotationDays    int
	AuditEnabled    bool
	AWS             secrets.AWSConfig
	GCP             secrets.GCPConfig
	Kubernetes      secrets.KubernetesConfig
	References      SecretReferences

	manager secrets.Manager
}

type SecretReferences struct {
	Database *secrets.Reference
	Stripe   *secrets.Reference
	Twilio   *secrets.Reference
	SMTP     *secrets.Reference
	Firebase *secrets.Reference
	JWTKeys  *secrets.Reference
}

func (s *SecretsSettings) Manager() secrets.Manager {
	return s.manager
}

func (c *Config) initializeSecrets() error {
	if c.Secrets.Provider == secrets.ProviderNone || c.Secrets.Provider == "" {
		return nil
	}

	cacheTTL := time.Duration(c.Secrets.CacheTTLSeconds) * time.Second
	if cacheTTL <= 0 {
		cacheTTL = 5 * time.Minute
	}

	rotation := time.Duration(c.Secrets.RotationDays) * 24 * time.Hour
	if rotation <= 0 {
		rotation = 90 * 24 * time.Hour
	}

	manager, err := secrets.NewManager(secrets.Config{
		Provider:         c.Secrets.Provider,
		CacheTTL:         cacheTTL,
		RotationInterval: rotation,
		AuditEnabled:     c.Secrets.AuditEnabled,
		AWS:              c.Secrets.AWS,
		GCP:              c.Secrets.GCP,
		Kubernetes:       c.Secrets.Kubernetes,
	})
	if err != nil {
		return fmt.Errorf("failed to initialize secrets manager: %w", err)
	}

	c.Secrets.manager = manager

	if err := c.applySecretOverrides(context.Background()); err != nil {
		return err
	}

	return nil
}

func (c *Config) populateSecretReferences() error {
	var err error
	refs := SecretReferences{}

	if refs.Database, err = parseSecretReference("database_credentials", secrets.SecretDatabase, getEnv("SECRETS_DB_PATH", "")); err != nil {
		return fmt.Errorf("invalid SECRETS_DB_PATH: %w", err)
	}
	if refs.Twilio, err = parseSecretReference("twilio_credentials", secrets.SecretTwilio, getEnv("SECRETS_TWILIO_PATH", "")); err != nil {
		return fmt.Errorf("invalid SECRETS_TWILIO_PATH: %w", err)
	}
	if refs.SMTP, err = parseSecretReference("smtp_credentials", secrets.SecretSMTP, getEnv("SECRETS_SMTP_PATH", "")); err != nil {
		return fmt.Errorf("invalid SECRETS_SMTP_PATH: %w", err)
	}
	if refs.Firebase, err = parseSecretReference("firebase_credentials", secrets.SecretFirebase, getEnv("SECRETS_FIREBASE_PATH", "")); err != nil {
		return fmt.Errorf("invalid SECRETS_FIREBASE_PATH: %w", err)
	}
	if refs.JWTKeys, err = parseSecretReference("jwt_signing_keys", secrets.SecretJWTKeys, getEnv("SECRETS_JWT_KEYS_PATH", "")); err != nil {
		return fmt.Errorf("invalid SECRETS_JWT_KEYS_PATH: %w", err)
	}

	c.Secrets.References = refs
	return nil
}

func (c *Config) applySecretOverrides(ctx context.Context) error {
	if c.Secrets.manager == nil {
		return nil
	}

	if ref := c.Secrets.References.Database; ref != nil {
		secret, err := c.Secrets.manager.GetSecret(ctx, *ref)
		if err != nil {
			return fmt.Errorf("fetch database secret: %w", err)
		}
		overrideString(&c.Database.Host, secret.Data["host"])
		overrideString(&c.Database.Port, secret.Data["port"])
		overrideString(&c.Database.User, firstNonEmpty(secret.Data["username"], secret.Data["user"]))
		overrideString(&c.Database.Password, secret.Data["password"])
		overrideString(&c.Database.DBName, firstNonEmpty(secret.Data["dbname"], secret.Data["database"]))
		overrideString(&c.Database.SSLMode, secret.Data["sslmode"])
	}

	if ref := c.Secrets.References.Twilio; ref != nil {
		secret, err := c.Secrets.manager.GetSecret(ctx, *ref)
		if err != nil {
			return fmt.Errorf("fetch twilio secret: %w", err)
		}
		overrideString(&c.Notifications.TwilioAccountSID, firstNonEmpty(secret.Data["account_sid"], secret.Data["sid"]))
		overrideString(&c.Notifications.TwilioAuthToken, firstNonEmpty(secret.Data["auth_token"], secret.Data["token"]))
		overrideString(&c.Notifications.TwilioFromNumber, firstNonEmpty(secret.Data["from_number"], secret.Data["phone_number"]))
	}

	if ref := c.Secrets.References.SMTP; ref != nil {
		secret, err := c.Secrets.manager.GetSecret(ctx, *ref)
		if err != nil {
			return fmt.Errorf("fetch smtp secret: %w", err)
		}
		overrideString(&c.Notifications.SMTPHost, secret.Data["host"])
		overrideString(&c.Notifications.SMTPPort, secret.Data["port"])
		overrideString(&c.Notifications.SMTPUsername, firstNonEmpty(secret.Data["username"], secret.Data["user"]))
		overrideString(&c.Notifications.SMTPPassword, secret.Data["password"])
		overrideString(&c.Notifications.SMTPFromEmail, secret.Data["from_email"])
		overrideString(&c.Notifications.SMTPFromName, secret.Data["from_name"])
	}

	if ref := c.Secrets.References.Firebase; ref != nil {
		secret, err := c.Secrets.manager.GetSecret(ctx, *ref)
		if err != nil {
			return fmt.Errorf("fetch firebase secret: %w", err)
		}

		if raw := firstNonEmpty(secret.Data["credentials_json"], secret.Data["service_account"]); raw != "" {
			c.Firebase.CredentialsJSON = raw
		} else if encoded := secret.Data["credentials_b64"]; encoded != "" {
			decoded, decodeErr := base64.StdEncoding.DecodeString(encoded)
			if decodeErr != nil {
				return fmt.Errorf("decode firebase credentials_b64: %w", decodeErr)
			}
			c.Firebase.CredentialsJSON = string(decoded)
		}

		overrideString(&c.Firebase.CredentialsPath, secret.Data["credentials_path"])
	}

	return nil
}

func parseSecretReference(name string, secretType secrets.SecretType, raw string) (*secrets.Reference, error) {
	if raw == "" {
		return nil, nil
	}
	ref, err := secrets.ParseReference(name, secretType, raw)
	if err != nil {
		return nil, err
	}
	return &ref, nil
}

func overrideString(target *string, candidate string) {
	if candidate != "" && target != nil {
		*target = candidate
	}
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
