package secrets

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"
)

// AWSConfig configures the AWS Secrets Manager provider.
type AWSConfig struct {
	Region          string
	AccessKeyID     string
	SecretAccessKey string
	SessionToken    string
	Profile         string
	Endpoint        string
}

type awsProvider struct {
	client *secretsmanager.Client
}

func newAWSProvider(ctx context.Context, cfg AWSConfig) (provider, error) {
	if cfg.Region == "" {
		return nil, fmt.Errorf("secrets: aws provider requires region")
	}

	loadOpts := []func(*config.LoadOptions) error{
		config.WithRegion(cfg.Region),
	}

	if cfg.Profile != "" {
		loadOpts = append(loadOpts, config.WithSharedConfigProfile(cfg.Profile))
	}

	if cfg.AccessKeyID != "" && cfg.SecretAccessKey != "" {
		staticProvider := credentials.NewStaticCredentialsProvider(cfg.AccessKeyID, cfg.SecretAccessKey, cfg.SessionToken)
		loadOpts = append(loadOpts, config.WithCredentialsProvider(aws.NewCredentialsCache(staticProvider)))
	}

	if cfg.Endpoint != "" {
		customResolver := aws.EndpointResolverWithOptionsFunc(func(service, region string, options ...interface{}) (aws.Endpoint, error) {
			return aws.Endpoint{
				URL:           cfg.Endpoint,
				SigningRegion: cfg.Region,
			}, nil
		})
		loadOpts = append(loadOpts, config.WithEndpointResolverWithOptions(customResolver))
	}

	awsCfg, err := config.LoadDefaultConfig(ctx, loadOpts...)
	if err != nil {
		return nil, fmt.Errorf("secrets: failed to load aws config: %w", err)
	}

	client := secretsmanager.NewFromConfig(awsCfg)
	return &awsProvider{client: client}, nil
}

func (a *awsProvider) Name() ProviderType {
	return ProviderAWS
}

func (a *awsProvider) Close() error {
	return nil
}

func (a *awsProvider) Fetch(ctx context.Context, ref Reference) (Secret, error) {
	input := &secretsmanager.GetSecretValueInput{
		SecretId: aws.String(ref.Path),
	}

	if ref.Version != "" {
		input.VersionId = aws.String(ref.Version)
	}

	result, err := a.client.GetSecretValue(ctx, input)
	if err != nil {
		return Secret{}, fmt.Errorf("secrets: aws fetch failed for %s: %w", ref.Path, err)
	}

	payload := make(map[string]string)
	if result.SecretString != nil {
		str := *result.SecretString
		var asMap map[string]string
		if err := json.Unmarshal([]byte(str), &asMap); err == nil {
			for k, v := range asMap {
				payload[k] = v
			}
		} else {
			payload["value"] = str
		}
	}

	if result.SecretBinary != nil {
		payload["binary"] = base64.StdEncoding.EncodeToString(result.SecretBinary)
	}

	metadata := Metadata{}
	if result.VersionId != nil {
		metadata.Version = *result.VersionId
	}
	if result.CreatedDate != nil {
		metadata.CreatedAt = *result.CreatedDate
	}
	if result.ARN != nil && metadata.CreatedAt.IsZero() {
		metadata.CreatedAt = time.Now().UTC()
	}

	return Secret{
		Data:     payload,
		Metadata: metadata,
	}, nil
}
