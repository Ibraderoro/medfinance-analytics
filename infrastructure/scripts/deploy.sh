#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy.sh — Production deployment script
# Usage: bash infrastructure/scripts/deploy.sh [--env staging|production]
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

YELLOW='\033[1;33m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

info()    { echo -e "${YELLOW}▶ $*${NC}"; }
success() { echo -e "${GREEN}✔ $*${NC}"; }
error()   { echo -e "${RED}✖ $*${NC}"; exit 1; }

ENV="${1:-production}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

info "Deploying MedFinance Analytics to: ${ENV}"

# Validate required env vars
[ -z "${JWT_SECRET:-}" ]        && error "JWT_SECRET is not set"
[ -z "${POSTGRES_PASSWORD:-}" ] && error "POSTGRES_PASSWORD is not set"
[ -z "${REDIS_PASSWORD:-}" ]    && error "REDIS_PASSWORD is not set"

info "Building Docker images..."
docker compose build --no-cache

info "Pulling latest images..."
docker compose pull --ignore-pull-failures

info "Starting stateful dependencies (PostgreSQL + Redis)..."
docker compose up -d postgres redis

info "Waiting for PostgreSQL to become healthy..."
until docker compose exec -T postgres pg_isready -U "${POSTGRES_USER:-medfinance_user}" -d "${POSTGRES_DB:-medfinance}" >/dev/null 2>&1; do
  sleep 2
done

info "Running database migrations..."
docker compose run --rm backend node apps/backend/dist/db/migrate.js

info "Starting application services..."
docker compose up -d --remove-orphans backend frontend nginx

info "Waiting for health checks..."
sleep 10

# Quick health check
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost/health || echo "000")
if [ "$HTTP_STATUS" = "200" ]; then
  success "Deployment complete! Health check passed (HTTP ${HTTP_STATUS})."
else
  error "Health check failed (HTTP ${HTTP_STATUS}). Check 'docker compose logs'."
fi
