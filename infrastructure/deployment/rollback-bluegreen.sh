#!/usr/bin/env bash
set -euo pipefail

ENVIRONMENT="production"
BASE_DIR="/opt/medfinance"
PUBLIC_URL=""
VERSION=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --environment) ENVIRONMENT="$2"; shift 2 ;;
    --base-dir) BASE_DIR="$2"; shift 2 ;;
    --public-url) PUBLIC_URL="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$PUBLIC_URL" ]] || { echo "--public-url is required" >&2; exit 2; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.bluegreen.yml"
STATE_DIR="$BASE_DIR/$ENVIRONMENT"
RUNTIME_ENV="$STATE_DIR/runtime.env"
[[ -f "$RUNTIME_ENV" ]] || { echo "Runtime env not found: $RUNTIME_ENV" >&2; exit 1; }

get_env_value() { sed -n "s/^$1=//p" "$RUNTIME_ENV" | tail -n 1; }
set_env_value() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$RUNTIME_ENV"; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$RUNTIME_ENV"
  else
    printf '%s=%s\n' "$key" "$value" >> "$RUNTIME_ENV"
  fi
}

CURRENT_COLOR="$(get_env_value ACTIVE_COLOR | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
if [[ "$CURRENT_COLOR" == "blue" ]]; then
  TARGET_COLOR="green"
  TARGET_VERSION="$(get_env_value GREEN_RELEASE_VERSION)"
elif [[ "$CURRENT_COLOR" == "green" ]]; then
  TARGET_COLOR="blue"
  TARGET_VERSION="$(get_env_value BLUE_RELEASE_VERSION)"
else
  echo "Invalid ACTIVE_COLOR in runtime state: ${CURRENT_COLOR:-<empty>}. Expected blue or green." >&2
  exit 1
fi
[[ -n "$VERSION" ]] && TARGET_VERSION="$VERSION"
[[ -n "$TARGET_VERSION" ]] || { echo "No rollback target version recorded" >&2; exit 1; }

compose() { docker compose --env-file "$RUNTIME_ENV" -f "$COMPOSE_FILE" "$@"; }
wait_for_edge() {
  local deadline=$((SECONDS + 120)) cid status
  while (( SECONDS < deadline )); do
    cid="$(compose ps -q edge 2>/dev/null || true)"
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || true)"
    [[ "$status" == "healthy" || "$status" == "running" ]] && return 0
    sleep 5
  done
  return 1
}

printf '▶ Rolling back %s traffic from %s to %s (%s)\n' "$ENVIRONMENT" "$CURRENT_COLOR" "$TARGET_COLOR" "$TARGET_VERSION"
set_env_value ACTIVE_COLOR "$TARGET_COLOR"
compose up -d "backend_$TARGET_COLOR" "frontend_$TARGET_COLOR"
compose up -d --no-deps --force-recreate edge
wait_for_edge
node "$SCRIPT_DIR/../../scripts/deployment/verify-deployment.js" \
  --url "$PUBLIC_URL/api/v1/health/live" \
  --expected-version "$TARGET_VERSION" \
  --timeout-ms 120000

ROLLBACK_FILE="$STATE_DIR/releases/rollback-$(date -u +%Y%m%dT%H%M%SZ).json"
cat > "$ROLLBACK_FILE" <<JSON
{
  "environment": "$ENVIRONMENT",
  "rolledBackAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "fromColor": "$CURRENT_COLOR",
  "toColor": "$TARGET_COLOR",
  "targetVersion": "$TARGET_VERSION",
  "triggeredBy": "${GITHUB_ACTOR:-local}",
  "githubRunId": "${GITHUB_RUN_ID:-unknown}"
}
JSON
ln -sfn "$ROLLBACK_FILE" "$STATE_DIR/current.json"
printf '✔ Rollback complete: %s\n' "$ROLLBACK_FILE"
