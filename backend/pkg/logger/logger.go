package logger

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

var log *zap.Logger

type contextKey string

const correlationIDContextKey contextKey = "correlation_id"

func Init(environment string) error {
	var cfg zap.Config

	if environment == "production" {
		cfg = zap.NewProductionConfig()
		cfg.EncoderConfig.TimeKey = "timestamp"
		cfg.EncoderConfig.EncodeTime = zapcore.ISO8601TimeEncoder
		cfg.EncoderConfig.EncodeLevel = zapcore.CapitalLevelEncoder
	} else {
		cfg = zap.NewDevelopmentConfig()

		cfg.EncoderConfig.TimeKey = "timestamp"
		cfg.EncoderConfig.LevelKey = "level"
		cfg.EncoderConfig.NameKey = "logger"
		cfg.EncoderConfig.CallerKey = "caller"
		cfg.EncoderConfig.MessageKey = "msg"
		cfg.EncoderConfig.StacktraceKey = "stacktrace"
		cfg.EncoderConfig.ConsoleSeparator = " "

		cfg.EncoderConfig.EncodeTime = func(t time.Time, enc zapcore.PrimitiveArrayEncoder) {
			enc.AppendString("\x1b[90m[" + t.Format("15:04:05.000") + "]\x1b[0m")
		}

		cfg.EncoderConfig.EncodeLevel = func(l zapcore.Level, enc zapcore.PrimitiveArrayEncoder) {
			pid := os.Getpid()
			levelStr := l.CapitalString()
			var colorStr string
			switch l {
			case zapcore.DebugLevel:
				colorStr = "\x1b[34m"
			case zapcore.InfoLevel:
				colorStr = "\x1b[32m"
			case zapcore.WarnLevel:
				colorStr = "\x1b[33m"
			case zapcore.ErrorLevel, zapcore.DPanicLevel, zapcore.PanicLevel, zapcore.FatalLevel:
				colorStr = "\x1b[31m"
			default:
				colorStr = "\x1b[37m"
			}
			reset := "\x1b[0m"
			enc.AppendString(fmt.Sprintf("%s%s%s \x1b[90m(%d):\x1b[0m", colorStr, levelStr, reset, pid))
		}

		cfg.EncoderConfig.EncodeCaller = func(caller zapcore.EntryCaller, enc zapcore.PrimitiveArrayEncoder) {
			enc.AppendString("\x1b[33m[" + caller.TrimmedPath() + "]\x1b[0m")
		}
		cfg.Encoding = "console"
	}

	var err error
	log, err = cfg.Build(zap.AddCaller(), zap.AddStacktrace(zapcore.ErrorLevel), zap.AddCallerSkip(1))
	if err != nil {
		return err
	}

	if environment != "production" {
		log = log.WithOptions(zap.WrapCore(func(c zapcore.Core) zapcore.Core {
			return &pinoColoredCore{Core: c}
		}))

		gin.DefaultWriter = &ginZapWriter{logger: log}
		gin.DefaultErrorWriter = &ginZapWriter{logger: log, isError: true}
		gin.ForceConsoleColor()
	}

	return nil
}

type pinoColoredCore struct {
	zapcore.Core
}

func (c *pinoColoredCore) With(fields []zapcore.Field) zapcore.Core {
	return &pinoColoredCore{Core: c.Core.With(fields)}
}

func (c *pinoColoredCore) Check(ent zapcore.Entry, ce *zapcore.CheckedEntry) *zapcore.CheckedEntry {
	if c.Enabled(ent.Level) {
		return ce.AddCore(ent, c)
	}
	return ce
}

func (c *pinoColoredCore) Write(ent zapcore.Entry, fields []zapcore.Field) error {

	msgColor := "\x1b[36m"
	if ent.Level >= zapcore.ErrorLevel {
		msgColor = "\x1b[31m"
	}
	ent.Message = fmt.Sprintf("%s%s\x1b[0m", msgColor, ent.Message)

	if ent.Stack != "" {
		ent.Stack = fmt.Sprintf("\x1b[31m%s\x1b[0m", ent.Stack)
	}

	return c.Core.Write(ent, fields)
}

type ginZapWriter struct {
	logger  *zap.Logger
	isError bool
}

func (gw *ginZapWriter) Write(p []byte) (n int, err error) {
	msg := strings.TrimSpace(string(p))
	if msg == "" {
		return len(p), nil
	}
	if gw.isError {
		gw.logger.Error(msg)
	} else {
		gw.logger.Info(msg)
	}
	return len(p), nil
}

func Get() *zap.Logger {
	if log == nil {
		Init("development")
	}
	return log
}

func WithContext(ctx context.Context) *zap.Logger {
	if ctx == nil {
		return Get()
	}

	if correlationID := CorrelationIDFromContext(ctx); correlationID != "" {
		return Get().With(zap.String("correlation_id", correlationID))
	}

	return Get()
}

func ContextWithCorrelationID(ctx context.Context, correlationID string) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, correlationIDContextKey, correlationID)
}

func CorrelationIDFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	if v := ctx.Value(correlationIDContextKey); v != nil {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func Info(msg string, fields ...zap.Field) { Get().Info(msg, fields...) }
func InfoContext(ctx context.Context, msg string, fields ...zap.Field) {
	WithContext(ctx).Info(msg, fields...)
}

func Warn(msg string, fields ...zap.Field) { Get().Warn(msg, fields...) }
func WarnContext(ctx context.Context, msg string, fields ...zap.Field) {
	WithContext(ctx).Warn(msg, fields...)
}

func Error(msg string, fields ...zap.Field) { Get().Error(msg, fields...) }
func ErrorContext(ctx context.Context, msg string, fields ...zap.Field) {
	WithContext(ctx).Error(msg, fields...)
}

func Panic(msg string, fields ...zap.Field) { Get().Panic(msg, fields...) }
func PanicContext(ctx context.Context, msg string, fields ...zap.Field) {
	WithContext(ctx).Panic(msg, fields...)
}

func Debug(msg string, fields ...zap.Field) {
	Get().Debug(msg, fields...)
}

func DebugContext(ctx context.Context, msg string, fields ...zap.Field) {
	WithContext(ctx).Debug(msg, fields...)
}

func Fatal(msg string, fields ...zap.Field) {
	Get().Fatal(msg, fields...)
}

func FatalContext(ctx context.Context, msg string, fields ...zap.Field) {
	WithContext(ctx).Fatal(msg, fields...)
}
func Sync() error {
	if log != nil {
		return log.Sync()
	}
	return nil
}
