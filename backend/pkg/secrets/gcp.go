package secrets

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	secretmanager "cloud.google.com/go/secretmanager/apiv1"
	"cloud.google.com/go/secretmanager/apiv1/secretmanagerpb"
	"google.golang.org/api/option"
)

// GCPConfig configures Google Secret Manager access.
type GCPConfig struct {
	ProjectID       string
	CredentialsJSON string
	CredentialsFile string
}

type gcpProvider struct {
	client  *secretmanager.Client
	project string
}

func newGCPProvider(ctx context.Context, cfg GCPConfig) (provider, error) {
	if cfg.ProjectID == "" {
		return nil, fmt.Errorf("secrets: gcp provider requires project id")
	}

	opts := []option.ClientOption{}
	if cfg.CredentialsJSON != "" {
		opts = append(opts, option.WithCredentialsJSON([]byte(cfg.CredentialsJSON)))
	} else if cfg.CredentialsFile != "" {
		opts = append(opts, option.WithCredentialsFile(cfg.CredentialsFile))
	}

	client, err := secretmanager.NewClient(ctx, opts...)
	if err != nil {
		return nil, fmt.Errorf("secrets: failed to create gcp secret manager client: %w", err)
	}

	return &gcpProvider{
		client:  client,
		project: cfg.ProjectID,
	}, nil
}

func (g *gcpProvider) Name() ProviderType {
	return ProviderGCP
}

func (g *gcpProvider) Close() error {
	return g.client.Close()
}

func (g *gcpProvider) Fetch(ctx context.Context, ref Reference) (Secret, error) {
	name := ref.Path
	if !strings.HasPrefix(name, "projects/") {
		version := ref.Version
		if version == "" {
			version = "latest"
		}
		name = fmt.Sprintf("projects/%s/secrets/%s/versions/%s", g.project, strings.Trim(ref.Path, "/"), version)
	}

	resp, err := g.client.AccessSecretVersion(ctx, &secretmanagerpb.AccessSecretVersionRequest{Name: name})
	if err != nil {
		return Secret{}, fmt.Errorf("secrets: gcp fetch failed for %s: %w", ref.Path, err)
	}

	payload := make(map[string]string)
	if resp.Payload != nil {
		data := resp.Payload.Data
		var asMap map[string]string
		if err := json.Unmarshal(data, &asMap); err == nil {
			for k, v := range asMap {
				payload[k] = v
			}
		} else {
			payload["value"] = string(data)
		}
	}

	metadata := Metadata{
		Version: resp.Name,
	}
	if resp.Payload != nil && resp.Payload.Data != nil {
		metadata.CreatedAt = time.Now().UTC()
	}

	return Secret{
		Data:     payload,
		Metadata: metadata,
	}, nil
}
