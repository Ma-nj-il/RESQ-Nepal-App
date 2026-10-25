package jwtkeys

import "context"

type Store interface {
	Load(ctx context.Context) ([]SigningKey, error)
	Save(ctx context.Context, keys []SigningKey) error
}
