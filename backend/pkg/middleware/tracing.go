package middleware

import (
	"github.com/gin-gonic/gin"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
)

func TracingMiddleware(serviceName string) gin.HandlerFunc {
	tracer := otel.Tracer(serviceName)
	propagator := otel.GetTextMapPropagator()

	return func(c *gin.Context) {
		ctx := propagator.Extract(c.Request.Context(), propagation.HeaderCarrier(c.Request.Header))

		spanName := c.Request.Method + " " + c.FullPath()
		if c.FullPath() == "" {
			spanName = c.Request.Method + " " + c.Request.URL.Path
		}

		ctx, span := tracer.Start(ctx, spanName,
			trace.WithSpanKind(trace.SpanKindServer),
			trace.WithAttributes(
				attribute.String("http.method", c.Request.Method),
				attribute.String("http.url", c.Request.URL.String()),
				attribute.String("http.route", c.FullPath()),
				attribute.String("http.scheme", c.Request.URL.Scheme),
				attribute.String("http.host", c.Request.Host),
				attribute.String("http.user_agent", c.Request.UserAgent()),
				attribute.String("http.client_ip", c.ClientIP()),
				attribute.String("net.peer.ip", c.ClientIP()),
			),
		)
		defer span.End()

		c.Request = c.Request.WithContext(ctx)

		if span.SpanContext().HasTraceID() {
			c.Header("X-Trace-ID", span.SpanContext().TraceID().String())
		}

		if requestID := c.GetString("request_id"); requestID != "" {
			span.SetAttributes(attribute.String("http.request_id", requestID))
		}

		c.Next()

		status := c.Writer.Status()
		span.SetAttributes(
			attribute.Int("http.status_code", status),
			attribute.Int("http.response_size", c.Writer.Size()),
		)

		if status >= 500 {
			span.SetStatus(codes.Error, "Internal Server Error")
		} else if status >= 400 {
			span.SetStatus(codes.Error, "Client Error")
		} else {
			span.SetStatus(codes.Ok, "")
		}

		if len(c.Errors) > 0 {
			span.SetStatus(codes.Error, c.Errors.String())
			for _, err := range c.Errors {
				span.RecordError(err.Err)
			}
		}
	}
}

func GetSpanFromContext(c *gin.Context) trace.Span {
	return trace.SpanFromContext(c.Request.Context())
}

func AddSpanAttributes(c *gin.Context, attrs ...attribute.KeyValue) {
	span := trace.SpanFromContext(c.Request.Context())
	if span.IsRecording() {
		span.SetAttributes(attrs...)
	}
}

func AddSpanEvent(c *gin.Context, name string, attrs ...attribute.KeyValue) {
	span := trace.SpanFromContext(c.Request.Context())
	if span.IsRecording() {
		span.AddEvent(name, trace.WithAttributes(attrs...))
	}
}

func RecordSpanError(c *gin.Context, err error, attrs ...attribute.KeyValue) {
	span := trace.SpanFromContext(c.Request.Context())
	if span.IsRecording() {
		span.RecordError(err, trace.WithAttributes(attrs...))
		span.SetStatus(codes.Error, err.Error())
	}
}
