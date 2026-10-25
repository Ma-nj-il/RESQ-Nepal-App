package scheduler

import (
	"context"
	"database/sql"
)

// Database defines the database operations required by the scheduler worker.
// Uses standard database/sql interfaces for compatibility with GORM's underlying sql.DB.
type Database interface {
	// QueryContext executes a query that returns rows, typically a SELECT.
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)

	// ExecContext executes a query that doesn't return rows, typically INSERT, UPDATE, DELETE.
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}
