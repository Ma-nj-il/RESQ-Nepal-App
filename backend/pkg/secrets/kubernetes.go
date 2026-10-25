package secrets

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

type KubernetesConfig struct {
	BasePath string
}

type kubernetesProvider struct {
	basePath string
}

func newKubernetesProvider(cfg KubernetesConfig) (provider, error) {
	base := cfg.BasePath
	if base == "" {
		base = "/var/run/secrets"
	}

	info, err := os.Stat(base)
	if err != nil {
		return nil, fmt.Errorf("secrets: kubernetes secrets base %s not accessible: %w", base, err)
	}

	if !info.IsDir() {
		return nil, fmt.Errorf("secrets: kubernetes secrets base %s is not a directory", base)
	}

	return &kubernetesProvider{basePath: base}, nil
}

func (k *kubernetesProvider) Name() ProviderType {
	return ProviderKubernetes
}

func (k *kubernetesProvider) Close() error {
	return nil
}

func (k *kubernetesProvider) Fetch(ctx context.Context, ref Reference) (Secret, error) {
	target := filepath.Join(k.basePath, ref.Path)
	info, err := os.Stat(target)
	if err != nil {
		return Secret{}, fmt.Errorf("secrets: kubernetes path %s not found: %w", target, err)
	}

	data := make(map[string]string)

	if info.IsDir() {
		err = filepath.WalkDir(target, func(path string, d fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if d.IsDir() {
				return nil
			}
			content, readErr := os.ReadFile(path)
			if readErr != nil {
				return readErr
			}
			key := strings.TrimPrefix(path, target+string(os.PathSeparator))
			data[key] = strings.TrimSpace(string(content))
			return nil
		})
		if err != nil {
			return Secret{}, err
		}
	} else {
		content, readErr := os.ReadFile(target)
		if readErr != nil {
			return Secret{}, readErr
		}
		data[filepath.Base(target)] = strings.TrimSpace(string(content))
	}

	return Secret{Data: data}, nil
}
