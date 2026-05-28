#!/usr/bin/env bash
# Health-gated blue/green deployment for a self-hosted GitHub runner on the
# production/staging container host. This avoids SSH deploys while retaining a
# small-team operational footprint.
set -euo pipefail

usage() {
  cat <<USAGE
Usage: $0 --environment <staging|production> --version <version> \\
  --backend-image <ghcr image@sha256:digest> --frontend-image <ghcr image@sha256:digest> \\
  --public-url <https://host> [--base-dir /opt/medfinance] [--env-file /opt/medfinance/secrets/app.env]
USAGE
}

ENVIRONMENT=""
VERSION=""
BACKEND_IMAGE=""
FRONTEND_IMAGE=""
PUBLIC_URL=""
BASE_DIR="/opt/medfinance"
SECRET_ENV_FILE="/opt/medfinance/secrets/app.env"
COMPOSE_PROJECT_NAME="medfinance"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --environment) ENVIRONMENT="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --backend-image) BACKEND_IMAGE="$2"; shift 2 ;;
    --frontend-image) FRONTEND_IMAGE="$2"; shift 2 ;;
    --public-url) PUBLIC_URL="$2"; shift 2 ;;
    --base-dir) BASE_DIR="$2"; shift 2 ;;
    --env-file) SECRET_ENV_FILE="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

log() { printf '▶ %s\n' "$*"; }
fail() { printf '✖ %s\n' "$*" >&2; exit 1; }

[[ -n "$ENVIRONMENT" ]] || fail "--environment is required"
[[ -n "$VERSION" ]] || fail "--version is required"
[[ -n "$BACKEND_IMAGE" ]] || fail "--backend-image is required"
[[ -n "$FRONTEND_IMAGE" ]] || fail "--frontend-image is required"
[[ -n "$PUBLIC_URL" ]] || fail "--public-url is required"
[[ "$BACKEND_IMAGE" == *@sha256:* ]] || fail "backend image must be pinned by immutable digest"
[[ "$FRONTEND_IMAGE" == *@sha256:* ]] || fail "frontend image must be pinned by immutable digest"
[[ -f "$SECRET_ENV_FILE" ]] || fail "secret env file not found: $SECRET_ENV_FILE"

grep -Eq '^DATABASE_URL=' "$SECRET_ENV_FILE" || fail "DATABASE_URL must be injected through $SECRET_ENV_FILE"
grep -Eq '^REDIS_URL=' "$SECRET_ENV_FILE" || fail "REDIS_URL must be injected through $SECRET_ENV_FILE"
if grep -Eq '^(POSTGRES_PASSWORD|REDIS_PASSWORD)=' "$SECRET_ENV_FILE"; then
  fail "Use managed DATABASE_URL/REDIS_URL secret injection instead of raw POSTGRES_PASSWORD/REDIS_PASSWORD"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.bluegreen.yml"
STATE_DIR="$BASE_DIR/$ENVIRONMENT"
RELEASE_DIR="$STATE_DIR/releases"
RUNTIME_ENV="$STATE_DIR/runtime.env"
LOCK_DIR="$STATE_DIR/deploy.lock"
mkdir -p "$STATE_DIR" "$RELEASE_DIR"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  fail "deployment lock already held at $LOCK_DIR"
fi
cleanup() { rmdir "$LOCK_DIR" 2>/dev/null || true; }
trap cleanup EXIT

get_env_value() {
  local key="$1" file="$2"
  [[ -f "$file" ]] || return 0
  sed -n "s/^${key}=//p" "$file" | tail -n 1
}

CURRENT_COLOR="$(get_env_value ACTIVE_COLOR "$RUNTIME_ENV")"
[[ -n "$CURRENT_COLOR" ]] || CURRENT_COLOR="green"
if [[ "$CURRENT_COLOR" == "blue" ]]; then
  CANDIDATE_COLOR="green"
else
  CANDIDATE_COLOR="blue"
fi

BLUE_BACKEND="$(get_env_value BACKEND_BLUE_IMAGE "$RUNTIME_ENV")"
GREEN_BACKEND="$(get_env_value BACKEND_GREEN_IMAGE "$RUNTIME_ENV")"
BLUE_FRONTEND="$(get_env_value FRONTEND_BLUE_IMAGE "$RUNTIME_ENV")"
GREEN_FRONTEND="$(get_env_value FRONTEND_GREEN_IMAGE "$RUNTIME_ENV")"
BLUE_VERSION="$(get_env_value BLUE_RELEASE_VERSION "$RUNTIME_ENV")"
GREEN_VERSION="$(get_env_value GREEN_RELEASE_VERSION "$RUNTIME_ENV")"

if [[ "$CANDIDATE_COLOR" == "blue" ]]; then
  BLUE_BACKEND="$BACKEND_IMAGE"; BLUE_FRONTEND="$FRONTEND_IMAGE"; BLUE_VERSION="$VERSION"
  GREEN_BACKEND="${GREEN_BACKEND:-$BACKEND_IMAGE}"; GREEN_FRONTEND="${GREEN_FRONTEND:-$FRONTEND_IMAGE}"; GREEN_VERSION="${GREEN_VERSION:-$VERSION}"
else
  GREEN_BACKEND="$BACKEND_IMAGE"; GREEN_FRONTEND="$FRONTEND_IMAGE"; GREEN_VERSION="$VERSION"
  BLUE_BACKEND="${BLUE_BACKEND:-$BACKEND_IMAGE}"; BLUE_FRONTEND="${BLUE_FRONTEND:-$FRONTEND_IMAGE}"; BLUE_VERSION="${BLUE_VERSION:-$VERSION}"
fi

write_runtime_env() {
  local active="$1"
  cat > "$RUNTIME_ENV" <<ENV
COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME-$ENVIRONMENT
DEPLOY_ENV_FILE=$SECRET_ENV_FILE
ACTIVE_COLOR=$active
BACKEND_BLUE_IMAGE=$BLUE_BACKEND
BACKEND_GREEN_IMAGE=$GREEN_BACKEND
FRONTEND_BLUE_IMAGE=$BLUE_FRONTEND
FRONTEND_GREEN_IMAGE=$GREEN_FRONTEND
MIGRATION_IMAGE=$BACKEND_IMAGE
BLUE_RELEASE_VERSION=$BLUE_VERSION
GREEN_RELEASE_VERSION=$GREEN_VERSION
RELEASE_GIT_SHA=${GITHUB_SHA:-unknown}
EDGE_HTTP_BIND=0.0.0.0
EDGE_HTTP_PORT=80
ENV
}

compose() {
  docker compose --env-file "$RUNTIME_ENV" -f "$COMPOSE_FILE" "$@"
}

wait_for_service_health() {
  local service="$1" timeout_seconds="${2:-180}" deadline=$((SECONDS + timeout_seconds))
  while (( SECONDS < deadline )); do
    local cid status
    cid="$(compose ps -q "$service" 2>/dev/null || true)"
    if [[ -n "$cid" ]]; then
      status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || true)"
      [[ "$status" == "healthy" || "$status" == "running" ]] && return 0
      [[ "$status" == "unhealthy" || "$status" == "exited" ]] && return 1
    fi
    sleep 5
  done
  return 1
}

verify_public_url() {
  node "$SCRIPT_DIR/../../scripts/deployment/verify-deployment.js" \
    --url "$PUBLIC_URL/api/v1/health/ready" \
    --expected-version "$VERSION" \
    --timeout-ms 180000
}

rollback_edge() {
  local previous="$1"
  log "Rolling edge traffic back to $previous"
  write_runtime_env "$previous"
  compose up -d "backend_$previous" "frontend_$previous" >/dev/null
  wait_for_service_health "backend_$previous" 120 || true
  wait_for_service_health "frontend_$previous" 120 || true
  compose up -d --no-deps --force-recreate edge >/dev/null
}

log "Preparing $ENVIRONMENT deployment $VERSION to $CANDIDATE_COLOR"
write_runtime_env "$CURRENT_COLOR"

log "Pulling immutable image digests"
compose pull "backend_$CANDIDATE_COLOR" "frontend_$CANDIDATE_COLOR" migration

log "Running migration preflight and migrations from backend digest"
compose run --rm migration node apps/backend/dist/db/migrate.js preflight
compose run --rm migration node apps/backend/dist/db/migrate.js

log "Starting candidate services on private network"
compose up -d "backend_$CANDIDATE_COLOR" "frontend_$CANDIDATE_COLOR"
wait_for_service_health "backend_$CANDIDATE_COLOR" 240 || fail "candidate backend did not become healthy"
wait_for_service_health "frontend_$CANDIDATE_COLOR" 180 || fail "candidate frontend did not become healthy"

log "Switching edge to $CANDIDATE_COLOR"
write_runtime_env "$CANDIDATE_COLOR"
compose up -d --no-deps --force-recreate edge
wait_for_service_health edge 120 || { rollback_edge "$CURRENT_COLOR"; fail "edge did not become healthy"; }

if ! verify_public_url; then
  rollback_edge "$CURRENT_COLOR"
  fail "deployment verification failed; traffic restored to $CURRENT_COLOR"
fi

RELEASE_FILE="$RELEASE_DIR/$VERSION.json"
cat > "$RELEASE_FILE" <<JSON
{
  "environment": "$ENVIRONMENT",
  "version": "$VERSION",
  "activeColor": "$CANDIDATE_COLOR",
  "previousColor": "$CURRENT_COLOR",
  "backendImage": "$BACKEND_IMAGE",
  "frontendImage": "$FRONTEND_IMAGE",
  "publicUrl": "$PUBLIC_URL",
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "deployedBy": "${GITHUB_ACTOR:-local}",
  "githubSha": "${GITHUB_SHA:-unknown}",
  "githubRunId": "${GITHUB_RUN_ID:-unknown}"
}
JSON
ln -sfn "$RELEASE_FILE" "$STATE_DIR/current.json"
log "Deployment complete: $RELEASE_FILE"
