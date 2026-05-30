#!/usr/bin/env bash
# Legacy entrypoint retained for operators who still have muscle memory around
# infrastructure/scripts/deploy.sh. Production deployments now use the
# health-gated blue/green runner with immutable image digests.
set -euo pipefail

cat >&2 <<'MSG'
The legacy SSH/Docker Compose deployment flow has been retired.

Use:
  bash infrastructure/deployment/deploy-bluegreen.sh \
    --environment production \
    --version <version> \
    --backend-image ghcr.io/<org>/<repo>/backend@sha256:<digest> \
    --frontend-image ghcr.io/<org>/<repo>/frontend@sha256:<digest> \
    --public-url https://<host>

Rollback:
  bash infrastructure/deployment/rollback-bluegreen.sh \
    --environment production \
    --public-url https://<host>

GitHub Actions runs these commands on the self-hosted deployment runner; do not
reintroduce SSH deploys or mutable latest tags.
MSG
exit 2
