FROM golang:1.24-alpine AS builder

RUN apk add --no-cache git make

WORKDIR /app

COPY go.mod go.sum ./

COPY third_party ./third_party

RUN go mod download

COPY . .

ARG SERVICE_NAME

RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o /app/service ./cmd/${SERVICE_NAME}

FROM alpine:latest

RUN apk --no-cache add ca-certificates

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /home/appuser

COPY --from=builder /app/service .

USER appuser

EXPOSE 8080

CMD ["./service"]
