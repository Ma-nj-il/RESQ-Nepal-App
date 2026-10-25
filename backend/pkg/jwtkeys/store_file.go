package jwtkeys

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

type fileStore struct {
	path string
}

func (s *fileStore) Load(_ context.Context) ([]SigningKey, error) {
	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	var keys []SigningKey
	if err := json.Unmarshal(data, &keys); err != nil {
		return nil, err
	}
	return keys, nil
}

func (s *fileStore) Save(_ context.Context, keys []SigningKey) error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return err
	}

	data, err := json.MarshalIndent(keys, "", "  ")
	if err != nil {
		return err
	}

	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}
