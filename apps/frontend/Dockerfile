# syntax=docker/dockerfile:1.7

# ── Stage 1: Build ────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY apps/frontend/package.json apps/frontend/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm ci --workspaces

COPY packages/shared/ packages/shared/
COPY apps/frontend/ apps/frontend/

ARG VITE_API_BASE_URL=/api/v1
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=apps/frontend

# ── Stage 2: Serve with Nginx ─────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

COPY --from=builder /app/apps/frontend/dist /usr/share/nginx/html
COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost/health || exit 1
