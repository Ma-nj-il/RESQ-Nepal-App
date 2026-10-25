package async

import (
	"context"
	"runtime/debug"
	"time"

	"github.com/bikky-kc013/medi-ambulance/pkg/logger"
	"go.uber.org/zap"
)

type contextKey string

const (
	correlationIDKey contextKey = "correlation_id"
	spanIDKey        contextKey = "span_id"
	userIDKey        contextKey = "user_id"
)

type TaskContext struct {
	CorrelationID string
	SpanID        string
	UserID        string
	StartTime     time.Time
	TaskName      string
}

func CaptureContext(ctx context.Context, taskName string) TaskContext {
	tc := TaskContext{
		StartTime: time.Now(),
		TaskName:  taskName,
	}

	tc.CorrelationID = logger.CorrelationIDFromContext(ctx)

	if spanID, ok := ctx.Value(spanIDKey).(string); ok {
		tc.SpanID = spanID
	}
	if userID, ok := ctx.Value(userIDKey).(string); ok {
		tc.UserID = userID
	}

	return tc
}

func (tc TaskContext) NewContext() context.Context {
	ctx := context.Background()

	if tc.CorrelationID != "" {
		ctx = logger.ContextWithCorrelationID(ctx, tc.CorrelationID)
	}

	if tc.SpanID != "" {
		ctx = context.WithValue(ctx, spanIDKey, tc.SpanID)
	}
	if tc.UserID != "" {
		ctx = context.WithValue(ctx, userIDKey, tc.UserID)
	}

	return ctx
}

func (tc TaskContext) NewContextWithTimeout(timeout time.Duration) (context.Context, context.CancelFunc) {
	ctx := tc.NewContext()
	return context.WithTimeout(ctx, timeout)
}

func Go(ctx context.Context, taskName string, fn func(ctx context.Context)) {
	tc := CaptureContext(ctx, taskName)

	go func() {
		defer recoverWithLogging(tc)

		newCtx := tc.NewContext()
		fn(newCtx)

		logger.DebugContext(newCtx, "async task completed",
			zap.String("task", tc.TaskName),
			zap.Duration("duration", time.Since(tc.StartTime)),
		)
	}()
}

func GoWithTimeout(ctx context.Context, taskName string, timeout time.Duration, fn func(ctx context.Context)) {
	tc := CaptureContext(ctx, taskName)

	go func() {
		defer recoverWithLogging(tc)

		newCtx, cancel := tc.NewContextWithTimeout(timeout)
		defer cancel()

		done := make(chan struct{})
		go func() {
			defer close(done)
			fn(newCtx)
		}()

		select {
		case <-done:
			logger.DebugContext(newCtx, "async task completed",
				zap.String("task", tc.TaskName),
				zap.Duration("duration", time.Since(tc.StartTime)),
			)
		case <-newCtx.Done():
			logger.WarnContext(newCtx, "async task timed out",
				zap.String("task", tc.TaskName),
				zap.Duration("timeout", timeout),
			)
		}
	}()
}

func GoWithCallback(ctx context.Context, taskName string, fn func(ctx context.Context) error, callback func(error)) {
	tc := CaptureContext(ctx, taskName)

	go func() {
		defer recoverWithLogging(tc)

		newCtx := tc.NewContext()
		err := fn(newCtx)

		if callback != nil {
			callback(err)
		}

		if err != nil {
			logger.ErrorContext(newCtx, "async task failed",
				zap.String("task", tc.TaskName),
				zap.Duration("duration", time.Since(tc.StartTime)),
				zap.Error(err),
			)
		} else {
			logger.DebugContext(newCtx, "async task completed",
				zap.String("task", tc.TaskName),
				zap.Duration("duration", time.Since(tc.StartTime)),
			)
		}
	}()
}

func recoverWithLogging(tc TaskContext) {
	if r := recover(); r != nil {
		ctx := tc.NewContext()
		logger.ErrorContext(ctx, "async task panicked",
			zap.String("task", tc.TaskName),
			zap.Any("panic", r),
			zap.String("stack", string(debug.Stack())),
		)
	}
}

func RunAll(ctx context.Context, taskName string, fns ...func(ctx context.Context)) {
	tc := CaptureContext(ctx, taskName)
	newCtx := tc.NewContext()

	done := make(chan struct{}, len(fns))

	for i, fn := range fns {
		go func(idx int, f func(ctx context.Context)) {
			defer func() {
				if r := recover(); r != nil {
					logger.ErrorContext(newCtx, "async task panicked",
						zap.String("task", tc.TaskName),
						zap.Int("index", idx),
						zap.Any("panic", r),
					)
				}
				done <- struct{}{}
			}()
			f(newCtx)
		}(i, fn)
	}

	for range fns {
		<-done
	}

	logger.DebugContext(newCtx, "all async tasks completed",
		zap.String("task", tc.TaskName),
		zap.Int("count", len(fns)),
		zap.Duration("duration", time.Since(tc.StartTime)),
	)
}

func WithCorrelationID(ctx context.Context, correlationID string) context.Context {
	return logger.ContextWithCorrelationID(ctx, correlationID)
}

func GetCorrelationID(ctx context.Context) string {
	return logger.CorrelationIDFromContext(ctx)
}

func WithUserID(ctx context.Context, userID string) context.Context {
	return context.WithValue(ctx, userIDKey, userID)
}

func GetUserID(ctx context.Context) string {
	if userID, ok := ctx.Value(userIDKey).(string); ok {
		return userID
	}
	return ""
}
