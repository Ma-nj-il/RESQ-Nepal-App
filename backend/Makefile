
RED := \033[0;31m
GREEN := \033[0;32m
YELLOW := \033[1;33m
NC := \033[0m

DB_HOST ?= localhost
DB_PORT ?= 5432
DB_USER ?= admin
DB_PASSWORD ?= admin
DB_NAME ?= medi-ambulance
DB_URL := postgres://$(DB_USER):$(DB_PASSWORD)@$(DB_HOST):$(DB_PORT)/$(DB_NAME)?sslmode=disable

SERVICES := auth rides geo payments notifications realtime fraud analytics admin promos scheduler ml-eta mobile

help:
	@echo "$(YELLOW)Available targets:$(NC)"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-30s$(NC) %s\n", $$1, $$2}'


setup: install-tools tidy
	@echo "$(GREEN)✓ Project setup complete!$(NC)"
	@echo "Next steps:"
	@echo "  1. Run 'make dev-infra' to start dependencies (Postgres + Redis + NATS)"
	@echo "  2. Run 'make migrate-up' to run database migrations"
	@echo "  3. Run 'make db-seed' to seed the database"
	@echo "  4. Run 'make run-auth' (or any service) to start developing"

dev: dev-infra
	@echo "$(YELLOW)Waiting for PostgreSQL to be healthy...$(NC)"
	@timeout=60; \
	while [ $$timeout -gt 0 ]; do \
		status=$$(docker inspect --format='{{.State.Health.Status}}' ridehailing-postgres-dev 2>/dev/null || echo "starting"); \
		if [ "$$status" = "healthy" ]; then \
			break; \
		fi; \
		echo "$(YELLOW)PostgreSQL status: $$status (waiting... $${timeout}s remaining)$(NC)"; \
		sleep 2; \
		timeout=$$((timeout - 2)); \
	done
	@status=$$(docker inspect --format='{{.State.Health.Status}}' ridehailing-postgres-dev 2>/dev/null); \
	if [ "$$status" != "healthy" ]; then \
		echo "$(RED)Error: PostgreSQL failed to become healthy$(NC)"; \
		exit 1; \
	fi
	@echo "$(GREEN)✓ PostgreSQL is healthy!$(NC)"
	@sleep 2
	@$(MAKE) migrate-up
	@echo "$(GREEN)✓ Development environment ready!$(NC)"
	@echo "Run 'make run-<service>' to start a service"

dev-infra:
	@echo "Starting infrastructure dependencies..."
	@docker-compose -f docker-compose.dev.yml up -d postgres redis nats
	@echo "$(GREEN)✓ Infrastructure started (Postgres + Redis + NATS)$(NC)"
	@echo "$(YELLOW)Services running on:$(NC)"
	@echo "  - PostgreSQL: localhost:5432"
	@echo "  - Redis: localhost:6379"
	@echo "  - NATS: localhost:4222 (monitoring: http://localhost:8222)"


dev-stop:
	@echo "Stopping development infrastructure..."
	@docker-compose -f docker-compose.dev.yml --profile observability --profile gateway down
	@echo "$(GREEN)✓ Infrastructure stopped!$(NC)"




build:
ifndef SERVICE
	@echo "$(RED)Error: SERVICE not specified$(NC)"
	@echo "Usage: make build SERVICE=auth"
	@exit 1
endif
	@echo "Building $(SERVICE) service..."
	@go build -o bin/$(SERVICE) ./cmd/$(SERVICE)

build-all:
	@echo "Building all services..."
	@for service in $(SERVICES); do \
		echo "  Building $$service..."; \
		go build -o bin/$$service ./cmd/$$service 2>/dev/null || echo "  $(YELLOW)Skipping $$service (not found)$(NC)"; \
	done
	@echo "$(GREEN)✓ Build complete!$(NC)"



lint:
	@echo "Running linter..."
	@golangci-lint run ./...
	@echo "$(GREEN)✓ Linting complete!$(NC)"

fmt:
	@echo "Formatting code..."
	@gofmt -w -s .
	@goimports -w -local github.com/bikky-kc013/medi-ambulance .
	@echo "$(GREEN)✓ Code formatted!$(NC)"

vet:
	@echo "Running go vet..."
	@go vet ./...
	@echo "$(GREEN)✓ Vet complete!$(NC)"



run-auth:
	@echo "Starting auth service..."
	@go run ./cmd/auth

run-rides:
	@echo "Starting rides service..."
	@go run ./cmd/rides

run-geo:
	@echo "Starting geo service..."
	@go run ./cmd/geo

run-payments:
	@echo "Starting payments service..."
	@go run ./cmd/payments

run-notifications:
	@echo "Starting notifications service..."
	@go run ./cmd/notifications

run-realtime:
	@echo "Starting realtime service..."
	@go run ./cmd/realtime

run-fraud:
	@echo "Starting fraud service..."
	@go run ./cmd/fraud

run-analytics:
	@echo "Starting analytics service..."
	@go run ./cmd/analytics

run-admin:
	@echo "Starting admin service..."
	@go run ./cmd/admin

run-promos:
	@echo "Starting promos service..."
	@go run ./cmd/promos

run-scheduler:
	@echo "Starting scheduler service..."
	@go run ./cmd/scheduler

run-ml-eta:
	@echo "Starting ML ETA service..."
	@go run ./cmd/ml-eta

run-mobile:
	@echo "Starting mobile service..."
	@go run ./cmd/mobile

run: run-all




logs:
ifndef SERVICE
	@echo "$(RED)Error: SERVICE not specified$(NC)"
	@echo "Usage: make logs SERVICE=admin"
	@exit 1
endif
	@tail -f ./logs/$(SERVICE).log

status:
	@echo "$(YELLOW)=== Service Status ===$(NC)"
	@echo ""
	@for service in $(SERVICES); do \
		if [ -f ".pids/$$service.pid" ]; then \
			pid=$$(cat .pids/$$service.pid); \
			if ps -p $$pid > /dev/null 2>&1; then \
				echo "$(GREEN)✓ $$service$(NC) (PID: $$pid)"; \
			else \
				echo "$(RED)✗ $$service$(NC) (stale PID file)"; \
			fi; \
		else \
			echo "$(YELLOW)⊘ $$service$(NC) (not running)"; \
		fi; \
	done

run-all-tmux:
	@echo "$(YELLOW)Starting all services in tmux...$(NC)"
	@echo "$(YELLOW)Note: This will start all services in a tmux session with multiple windows.$(NC)"
	@echo "$(YELLOW)Make sure tmux is installed: brew install tmux (macOS) or apt install tmux (Linux)$(NC)"
	@echo ""
	@if ! command -v tmux &> /dev/null; then \
		echo "$(RED)Error: tmux is not installed. Install it or use 'make run-all' instead.$(NC)"; \
		exit 1; \
	fi
	@tmux kill-session -t ridehailing 2>/dev/null || true
	@tmux new-session -d -s ridehailing -n auth 'make run-auth'
	@tmux new-window -t ridehailing -n rides 'make run-rides'
	@tmux new-window -t ridehailing -n geo 'make run-geo'
	@tmux new-window -t ridehailing -n payments 'make run-payments'
	@tmux new-window -t ridehailing -n notifications 'make run-notifications'
	@tmux new-window -t ridehailing -n realtime 'make run-realtime'
	@tmux new-window -t ridehailing -n fraud 'make run-fraud'
	@tmux new-window -t ridehailing -n analytics 'make run-analytics'
	@tmux new-window -t ridehailing -n admin 'make run-admin'
	@tmux new-window -t ridehailing -n promos 'make run-promos'
	@tmux new-window -t ridehailing -n scheduler 'make run-scheduler'
	@tmux new-window -t ridehailing -n ml-eta 'make run-ml-eta'
	@tmux new-window -t ridehailing -n mobile 'make run-mobile'
	@tmux select-window -t ridehailing:auth
	@echo "$(GREEN)✓ All 13 services started in tmux session 'ridehailing'$(NC)"
	@echo ""
	@echo "$(YELLOW)Services running on:$(NC)"
	@echo "  - auth:          http://localhost:8081"
	@echo "  - rides:         http://localhost:8082"
	@echo "  - geo:           http://localhost:8083"
	@echo "  - payments:      http://localhost:8084"
	@echo "  - notifications: http://localhost:8085"
	@echo "  - realtime:      http://localhost:8086"
	@echo "  - mobile:        http://localhost:8087"
	@echo "  - admin:         http://localhost:8088"
	@echo "  - promos:        http://localhost:8089"
	@echo "  - scheduler:     http://localhost:8090"
	@echo "  - analytics:     http://localhost:8091"
	@echo "  - fraud:         http://localhost:8092"
	@echo "  - ml-eta:        http://localhost:8093"
	@echo ""
	@echo "To view services:"
	@echo "  tmux attach -t ridehailing"
	@echo ""
	@echo "To stop all services:"
	@echo "  tmux kill-session -t ridehailing"
	@echo ""
	@echo "Tmux commands:"
	@echo "  Ctrl+B then D     - Detach from session"
	@echo "  Ctrl+B then N     - Next window"
	@echo "  Ctrl+B then P     - Previous window"
	@echo "  Ctrl+B then 0-9   - Switch to window by number"
	@echo "  Ctrl+B then W     - List all windows"


docker-up:
	@echo "Starting services with Docker Compose..."
	@docker-compose up -d
	@echo "$(GREEN)✓ Services started!$(NC)"

docker-down:
	@echo "Stopping services..."
	@docker-compose down
	@echo "$(GREEN)✓ Services stopped!$(NC)"

docker-build:
	@echo "Building Docker images..."
	@docker-compose build

docker-logs:
ifdef SERVICE
	@docker-compose logs -f $(SERVICE)
else
	@docker-compose logs -f
endif

docker-restart:
	@echo "Restarting services..."
	@docker-compose restart
	@echo "$(GREEN)✓ Services restarted!$(NC)"


migrate-up:
	@echo "Running migrations..."
	@migrate -path db/migrations -database "$(DB_URL)" up
	@echo "$(GREEN)✓ Migrations complete!$(NC)"

migrate-down:
	@echo "Rolling back migrations..."
	@migrate -path db/migrations -database "$(DB_URL)" down 1
	@echo "$(GREEN)✓ Rollback complete!$(NC)"

migrate-create:
ifndef NAME
	@echo "$(RED)Error: NAME not specified$(NC)"
	@echo "Usage: make migrate-create NAME=add_users_table"
	@exit 1
endif
	@migrate create -ext sql -dir db/migrations -seq $(NAME)
	@echo "$(GREEN)✓ Migration files created!$(NC)"

migrate-force:
ifndef VERSION
	@echo "$(RED)Error: VERSION not specified$(NC)"
	@echo "Usage: make migrate-force VERSION=1"
	@exit 1
endif
	@migrate -path db/migrations -database "$(DB_URL)" force $(VERSION)

migrate-version:
	@migrate -path db/migrations -database "$(DB_URL)" version


db-seed:
	@echo "Seeding database..."
	@./scripts/seed.sh
	@echo "$(GREEN)✓ Database seeded!$(NC)"

db-seed-docker:
	@./scripts/seed-docker.sh

db-reset: migrate-down migrate-up db-seed
	@echo "$(GREEN)✓ Database reset complete!$(NC)"

db-backup:
	@echo "Backing up database..."
	@mkdir -p backups
	@pg_dump -h $(DB_HOST) -p $(DB_PORT) -U $(DB_USER) $(DB_NAME) > backups/backup_$(shell date +%Y%m%d_%H%M%S).sql
	@echo "$(GREEN)✓ Backup created!$(NC)"

db-restore:
	@echo "$(YELLOW)This will restore from the latest backup. Continue? [y/N]$(NC)"
	@read -r response; \
	if [ "$$response" = "y" ] || [ "$$response" = "Y" ]; then \
		latest=$$(ls -t backups/*.sql 2>/dev/null | head -1); \
		if [ -z "$$latest" ]; then \
			echo "$(RED)No backup files found!$(NC)"; \
			exit 1; \
		fi; \
		echo "Restoring from $$latest..."; \
		psql -h $(DB_HOST) -p $(DB_PORT) -U $(DB_USER) -d $(DB_NAME) < $$latest; \
		echo "$(GREEN)✓ Database restored!$(NC)"; \
	else \
		echo "Restore cancelled."; \
	fi



tidy:
	@echo "Tidying modules..."
	@go mod tidy
	@echo "$(GREEN)✓ Modules tidied!$(NC)"

install-tools:
	@echo "Installing development tools..."
	@go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
	@go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@latest
	@go install golang.org/x/tools/cmd/goimports@latest
	@echo "$(GREEN)✓ Tools installed!$(NC)"

clean:
	@echo "Cleaning..."
	@rm -rf bin/
	@rm -f coverage.txt coverage.html
	@echo "$(GREEN)✓ Clean complete!$(NC)"


run-auth-dev:
	@SERVICE=auth air

run-rides-dev:
	@SERVICE=rides air

run-geo-dev:
	@SERVICE=geo air

run-admin-dev:
	@SERVICE=admin air
