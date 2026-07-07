#!/usr/bin/env bash
set -euo pipefail

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-medfinance-e2e-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}}"
export E2E_HTTP_PORT="${E2E_HTTP_PORT:-8080}"
export E2E_BASE_URL="${E2E_BASE_URL:-http://127.0.0.1:${E2E_HTTP_PORT}}"

cleanup() {
  docker compose -f docker-compose.e2e.yml down --volumes --remove-orphans
}

cleanup_on_exit() {
  local status=$?
  if [[ $status -ne 0 && ${E2E_PRESERVE_ON_FAILURE:-0} == "1" ]]; then
    return $status
  fi
  cleanup
}
trap cleanup_on_exit EXIT

cleanup >/dev/null 2>&1 || true

docker compose -f docker-compose.e2e.yml up --build --wait --wait-timeout 180 edge
npm run test:e2e:full --workspace=apps/frontend
