# MedFinance Analytics Monorepo Structure

## Root folders
- `apps/backend/`: Backend service source tree (API, business logic, jobs, tests).
- `apps/frontend/`: Frontend application source tree (UI, pages, hooks, charts, styles).
- `infrastructure/`: Environment/service configuration for platform dependencies.
- `docs/`: Project documentation and architecture notes.
- `scripts/`: Automation scripts for setup, maintenance, and CI helpers.
- `.github/`: GitHub metadata, workflows, and repository automation.

## Root files
- `docker-compose.yml`: Root compose entrypoint for multi-service orchestration.
- `README.md`: Project overview and getting-started guidance.
- `.env.example`: Template for required environment variables.
- `.gitignore`: Git ignore rules for build artifacts, secrets, and local files.

## Backend folders
- `apps/backend/src/config/`: Runtime configuration (env loading, database/cache config).
- `apps/backend/src/controllers/`: Request handlers and endpoint adapters.
- `apps/backend/src/services/`: Business/domain logic.
- `apps/backend/src/models/`: Data models and persistence layer definitions.
- `apps/backend/src/routes/`: Route registration and API wiring.
- `apps/backend/src/middleware/`: Cross-cutting HTTP middleware (auth, errors, logging).
- `apps/backend/src/utils/`: Reusable helper utilities.
- `apps/backend/src/__tests__/`: Backend test suites and test fixtures.

## Frontend folders
- `apps/frontend/src/components/`: Reusable UI and shared visual components.
- `apps/frontend/src/pages/`: Route-level screens/pages.
- `apps/frontend/src/hooks/`: Reusable React hooks/state helpers.
- `apps/frontend/src/services/`: API clients and data-access services.
- `apps/frontend/src/types/`: Shared frontend domain types.
- `apps/frontend/src/test/`: Frontend testing setup helpers.

## Infrastructure folders
- `infrastructure/postgres/`: PostgreSQL configuration, init assets, and SQL bootstrap resources.
- `infrastructure/redis/`: Redis configuration and persistence/runtime settings.
- `infrastructure/nginx/`: Nginx reverse proxy/static serving configuration (optional layer).

## Placeholders
`.gitkeep` files are used in empty directories to preserve the scaffold in git until implementation code is added.
