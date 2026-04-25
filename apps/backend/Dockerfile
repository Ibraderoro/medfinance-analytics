# ── Stage 1: Build ────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy workspace manifests
COPY package*.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY packages/shared/package.json packages/shared/package.json

# Install all dependencies (including devDependencies for build)
RUN npm ci --workspaces

# Copy source
COPY packages/shared/ packages/shared/
COPY apps/backend/ apps/backend/

# Build shared package first, then backend
RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=apps/backend

# ── Stage 2: Runtime ─────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

# Only copy production manifests
COPY package*.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY packages/shared/package.json packages/shared/package.json

# Install production dependencies only
RUN npm ci --workspaces --omit=dev

# Copy build artifacts
COPY --from=builder /app/apps/backend/dist apps/backend/dist
COPY --from=builder /app/packages/shared/dist packages/shared/dist

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/v1/health || exit 1

CMD ["node", "apps/backend/dist/index.js"]
