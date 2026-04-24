#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# setup.sh — One-shot local development environment setup
# Usage: bash infrastructure/scripts/setup.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m'

info()  { echo -e "${YELLOW}▶ $*${NC}"; }
success() { echo -e "${GREEN}✔ $*${NC}"; }

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

info "Checking prerequisites..."
command -v node  >/dev/null 2>&1 || { echo "Node.js is required"; exit 1; }
command -v npm   >/dev/null 2>&1 || { echo "npm is required"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "Docker is required"; exit 1; }

info "Copying .env files..."
[ -f .env ]                       || cp .env.example .env
[ -f apps/backend/.env ]          || cp apps/backend/.env.example apps/backend/.env

info "Installing npm workspace dependencies..."
npm install

info "Starting infrastructure services (PostgreSQL + Redis)..."
docker compose -f docker-compose.dev.yml up -d

info "Waiting for PostgreSQL to be ready..."
until docker exec medfinance_postgres_dev pg_isready -U medfinance_user -d medfinance_dev >/dev/null 2>&1; do
  sleep 1
done

info "Running database migrations..."
npm run migrate

success "Setup complete! 🚀"
echo ""
echo "  Start backend:   npm run dev --workspace=apps/backend"
echo "  Start frontend:  npm run dev --workspace=apps/frontend"
echo ""
