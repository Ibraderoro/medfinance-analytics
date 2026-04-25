# MedFinance Analytics

> Production-grade monorepo for real-time healthcare financial insights — dashboards, forecasting, and compliance monitoring for healthcare CFOs.

---

## 📐 Architecture Overview

```
medfinance-analytics/
├── apps/
│   ├── backend/          # Node.js + Express REST API
│   └── frontend/         # React + D3.js SPA
├── packages/
│   └── shared/           # Shared TypeScript types & utilities
├── infrastructure/
│   ├── docker/           # Production Dockerfiles
│   ├── nginx/            # Reverse-proxy configuration
│   ├── postgres/         # DB init scripts & migrations
│   ├── redis/            # Redis configuration
│   └── scripts/          # Setup, deploy & migrate shell scripts
└── .github/
    └── workflows/        # CI/CD pipelines (GitHub Actions)
```

---

## 🛠 Tech Stack

| Layer        | Technology                    |
|--------------|-------------------------------|
| Backend      | Node.js 20, Express 4, TypeScript |
| Frontend     | React 18, Vite, D3.js         |
| Database     | PostgreSQL 16                 |
| Cache        | Redis 7                       |
| DevOps       | Docker, Docker Compose        |
| CI/CD        | GitHub Actions                |

---

## 🚀 Quick Start

### Prerequisites
- [Node.js 20+](https://nodejs.org/)
- [Docker & Docker Compose](https://docs.docker.com/get-docker/)
- [npm 10+](https://www.npmjs.com/)

### Development

```bash
# 1. Clone the repo
git clone https://github.com/Ibraderoro/medfinance-analytics.git
cd medfinance-analytics

# 2. Copy environment variables
cp .env.example .env

# 3. Install all workspace dependencies
npm install

# 4. Start all services with Docker Compose (DB + Redis + API + Frontend)
docker-compose -f docker-compose.dev.yml up -d

# 5. Run database migrations
npm run migrate

# 6. Start backend in watch mode
npm run dev --workspace=apps/backend

# 7. Start frontend dev server
npm run dev --workspace=apps/frontend
```

### Production

```bash
# 1. Copy and edit production env vars
cp .env.example .env

# 2. Build production images
docker compose build

# 3. Start full production stack
docker compose --profile full up -d
```

### Run Services Independently

```bash
# Database + cache only
docker compose --profile core up -d postgres redis

# API only (expects DATABASE_URL/REDIS_* already reachable)
docker compose --profile api up -d backend

# Frontend only
docker compose --profile web up -d frontend

# Reverse proxy only
docker compose --profile proxy up -d nginx
```

---

## 📦 Workspace Scripts

| Command                        | Description                          |
|--------------------------------|--------------------------------------|
| `npm run dev`                  | Start all apps in development mode   |
| `npm run build`                | Build all apps                       |
| `npm run test`                 | Run tests across all workspaces      |
| `npm run lint`                 | Lint all workspaces                  |
| `npm run migrate`              | Run database migrations              |
| `make setup`                   | One-shot local environment setup     |
| `make deploy`                  | Deploy to production                 |

---

## 🏥 Core Features

- **Real-time Financial Dashboard** — KPIs, revenue, expense, and cash-flow charts powered by D3.js
- **Forecasting Engine** — Time-series forecasting for budget planning
- **Compliance Monitoring** — HIPAA & regulatory compliance tracking
- **Multi-tenant** — Supports multiple healthcare organisations
- **Role-based Access Control** — CFO, Finance Manager, Auditor roles

---

## 🗂 Detailed Structure

### `apps/backend`
Express REST API with:
- `src/config/` — database, redis, and env configuration
- `src/routes/` — API route definitions
- `src/controllers/` — request/response handlers
- `src/services/` — business logic layer
- `src/models/` — database model definitions
- `src/middleware/` — auth, error handling, rate-limiting, logging

### `apps/frontend`
React SPA with:
- `src/pages/` — top-level page components (Dashboard, Financials, Forecasting, Compliance)
- `src/components/` — reusable UI components & D3 chart wrappers
- `src/hooks/` — custom React hooks for data fetching
- `src/services/` — API client
- `src/store/` — global state management
- `src/types/` — TypeScript type definitions

### `packages/shared`
Shared between backend & frontend:
- `src/types/` — shared TypeScript interfaces
- `src/utils/` — shared utility functions (formatters, validators)

---

## 🐳 Infrastructure

### Docker Compose Services

| Service    | Default Port | Description              | Profile |
|------------|--------------|--------------------------|---------|
| postgres   | 5432         | PostgreSQL database      | `core` / `full` |
| redis      | 6379         | Redis cache              | `core` / `full` |
| backend    | 3001         | Express API              | `api` / `full` |
| frontend   | 3000         | Nginx serving frontend   | `web` / `full` |
| nginx      | 80, 443      | Reverse proxy            | `proxy` / `full` |

---

## 🔒 Environment Variables

Copy `.env.example` to `.env` and fill in the values. See [`apps/backend/.env.example`](apps/backend/.env.example) for the full backend variable reference.

Production Docker uses environment variables for:
- container ports: `PORT`, `FRONTEND_PORT`, `NGINX_HTTP_PORT`, `NGINX_HTTPS_PORT`
- backend dependencies: `DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`
- frontend build-time API endpoint: `VITE_API_BASE_URL`

---

## 📄 License

MIT © MedFinance Analytics
