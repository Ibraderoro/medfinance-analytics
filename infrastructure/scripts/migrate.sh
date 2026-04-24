#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# migrate.sh — Run database migrations
# Usage: bash infrastructure/scripts/migrate.sh [rollback]
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

ACTION="${1:-migrate}"

echo "Running migrations (action: ${ACTION})..."
npm run "${ACTION}" --workspace=apps/backend

echo "Done."
