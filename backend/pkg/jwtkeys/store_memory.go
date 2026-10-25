package jwtkeys

import (
	"context"
	"sync"
)

type memoryStore struct {
	mu   sync.RWMutex
	keys []SigningKey
}

func newMemoryStore() *memoryStore {
	return &memoryStore{}
}

func (s *memoryStore) Load(_ context.Context) ([]SigningKey, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return append([]SigningKey(nil), s.keys...), nil
}

func (s *memoryStore) Save(_ context.Context, keys []SigningKey) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.keys = append([]SigningKey(nil), keys...)
	return nil
}
