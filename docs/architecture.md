# MedFinance Analytics Architecture

## 1) System Design Overview

MedFinance Analytics is a monorepo-based, multi-tier platform for healthcare financial intelligence. The system is organized into four major layers:

- **Client Layer (`apps/frontend`)**: A React + Vite single-page application that renders dashboards and charts (D3) and calls backend APIs via Axios.
- **API Layer (`apps/backend`)**: An Express + TypeScript service exposing versioned REST endpoints (`/api/v1/*`).
- **Data Layer**:
  - **PostgreSQL** for durable transactional and analytical data.
  - **Redis** for low-latency caching and service health checks.
- **Infrastructure Layer (`infrastructure/*`)**: Docker Compose orchestration, Nginx reverse-proxy configuration, and database migration/bootstrap scripts.

The backend follows a layered architecture:

1. **Routes** map URI paths to controllers.
2. **Controllers** parse request parameters and map service outputs to responses.
3. **Services** contain business logic and SQL query orchestration.
4. **Config/Utility modules** encapsulate DB connections, Redis access, logging, and caching concerns.

## 2) Key Runtime Characteristics

- **API versioning**: All endpoints are mounted under `/api/v1`.
- **Security middleware**: `helmet`, credentialed CORS policy, HttpOnly cookie-backed JWT authentication (for business endpoints), CSRF validation for unsafe methods, and rate limiting.
- **Performance optimization**:
  - Gzip compression on responses.
  - Redis-backed caching for selected financial aggregate responses.
- **Observability**: Morgan + custom request logging middleware; health endpoint checks both PostgreSQL and Redis.

## 3) Component Interaction

- Frontend does not persist access tokens in `localStorage`; login/register/MFA responses set HttpOnly `medfinance_access_token` and `medfinance_refresh_token` cookies, and the Axios client sends them with `withCredentials: true`.
- The backend sets a readable `csrf_token` cookie and requires matching `x-csrf-token` headers on unsafe non-bootstrap requests.
- Protected backend route groups (`/financials`, `/forecasting`, `/compliance`, `/billing`, and `/insights`) are guarded by auth middleware that reads the access cookie for browser sessions.
- Services execute SQL against PostgreSQL; some high-value reads are cached in Redis.
- Errors flow to centralized Express error-handling middleware for consistent API behavior.

## 4) Data Flow Diagram (Text-Based)

```text
┌───────────────────────────────────────────────────────────────────┐
│                           End User                                │
└───────────────────────────────┬───────────────────────────────────┘
                                │ HTTPS
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│ Frontend SPA (React + Vite + D3)                                  │
│ - Pages: Dashboard, Financials, Forecasting, Compliance           │
│ - Axios client with credentials + CSRF header support              │
└───────────────────────────────┬───────────────────────────────────┘
                                │ /api/v1/* (JSON + HttpOnly auth cookies)
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│ Backend API (Express + TypeScript)                                │
│ Middleware: helmet → CORS → rate limiter → body parser → logging │
│ Route groups: /health, /financials, /forecasting, /compliance    │
│               /billing, /insights, /auth                         │
└───────────────┬───────────────────────────────┬───────────────────┘
                │                               │
                │ SQL                           │ cache / ping
                ▼                               ▼
┌───────────────────────────────┐     ┌─────────────────────────────┐
│ PostgreSQL                    │     │ Redis                        │
│ - financial transactions      │     │ - cached aggregates          │
│ - budgets                     │     │ - health check target        │
│ - compliance + audit records  │     └─────────────────────────────┘
└───────────────────────────────┘
```

## 5) Deployment Topology

Using Docker Compose, the canonical service topology includes:

- `frontend` on port `3000`
- `backend` on port `3001`
- `postgres` on port `5432`
- `redis` on port `6379`

For production, infrastructure assets include dedicated production Dockerfiles and Nginx reverse-proxy configuration.

## 6) Scalability and Evolution Notes

- Horizontal scaling is straightforward at the API tier due to stateless request handling.
- Redis can be expanded for broader query caching and session/token revocation strategies.
- Current forecasting uses trend extrapolation over recent months; architecture supports replacement with more advanced forecasting services without changing route contracts.
