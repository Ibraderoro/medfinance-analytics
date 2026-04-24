.PHONY: setup dev build test lint migrate deploy clean help

## ─── Help ─────────────────────────────────────────────────────────────────
help: ## Show this help message
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

## ─── Local development ─────────────────────────────────────────────────────
setup: ## First-time environment setup (copy .env, install deps, start infra)
	@bash infrastructure/scripts/setup.sh

dev: ## Start all services in development mode
	docker-compose -f docker-compose.dev.yml up -d
	npm run dev

build: ## Build all workspaces
	npm run build

test: ## Run all tests
	npm run test

lint: ## Lint all workspaces
	npm run lint

## ─── Database ──────────────────────────────────────────────────────────────
migrate: ## Run database migrations
	npm run migrate

migrate-rollback: ## Rollback last migration
	npm run migrate:rollback --workspace=apps/backend

## ─── Docker ────────────────────────────────────────────────────────────────
docker-build: ## Build production Docker images
	docker-compose build

docker-up: ## Start production Docker stack
	docker-compose up -d

docker-down: ## Stop all Docker services
	docker-compose down

docker-logs: ## Tail logs for all services
	docker-compose logs -f

## ─── Deployment ────────────────────────────────────────────────────────────
deploy: ## Deploy to production
	@bash infrastructure/scripts/deploy.sh

## ─── Cleanup ───────────────────────────────────────────────────────────────
clean: ## Remove build artifacts and node_modules
	npm run clean

.DEFAULT_GOAL := help
