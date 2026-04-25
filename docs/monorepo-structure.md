# MedFinance Analytics Monorepo Structure

## Root folders
- `backend/`: Backend service source tree (API, business logic, jobs, tests).
- `frontend/`: Frontend application source tree (UI, pages, hooks, charts, styles).
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
- `backend/src/config/`: Runtime configuration (env loading, database/cache config).
- `backend/src/controllers/`: Request handlers and endpoint adapters.
- `backend/src/services/`: Business/domain logic.
- `backend/src/models/`: Data models and persistence layer definitions.
- `backend/src/routes/`: Route registration and API wiring.
- `backend/src/middlewares/`: Cross-cutting HTTP middleware (auth, errors, logging).
- `backend/src/utils/`: Reusable helper utilities.
- `backend/src/jobs/`: Background jobs and schedulers.
- `backend/tests/`: Backend test suites and test fixtures.

## Frontend folders
- `frontend/src/components/`: Reusable UI and shared visual components.
- `frontend/src/pages/`: Route-level screens/pages.
- `frontend/src/hooks/`: Reusable React hooks/state helpers.
- `frontend/src/services/`: API clients and data-access services.
- `frontend/src/utils/`: General frontend utility helpers.
- `frontend/src/charts/`: Charting modules and visualization composition.
- `frontend/src/styles/`: Global styles, design tokens, and theme assets.

## Infrastructure folders
- `infrastructure/postgres/`: PostgreSQL configuration, init assets, and SQL bootstrap resources.
- `infrastructure/redis/`: Redis configuration and persistence/runtime settings.
- `infrastructure/nginx/`: Nginx reverse proxy/static serving configuration (optional layer).

## Placeholders
`.gitkeep` files are used in empty directories to preserve the scaffold in git until implementation code is added.
