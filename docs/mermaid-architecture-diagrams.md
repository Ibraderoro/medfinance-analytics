# Mermaid Architecture Diagrams

## 1) High-level system architecture

```mermaid
flowchart TB
  subgraph Internet[Public Internet]
    U[Users\nFinance, Compliance, Admin]
  end

  subgraph Edge[Edge Security Boundary]
    CDN[CDN / WAF / TLS Termination]
    FE[Frontend SPA\nReact + Vite]
  end

  subgraph App[Application Security Boundary]
    BE[Backend API\nExpress + TypeScript]
    AUTH[Auth + CSRF + Rate Limiting]
    OBS[Monitoring\nLogs Metrics Traces Alerts]
  end

  subgraph Data[Data Security Boundary]
    PG[(PostgreSQL\nSystem of Record)]
    RD[(Redis\nCache + Fast State)]
  end

  subgraph External[External Services]
    STRIPE[Stripe Billing]
  end

  U -->|HTTPS| CDN --> FE
  FE -->|HTTPS /api/v1| BE
  BE --> AUTH
  AUTH --> PG
  AUTH --> RD
  BE --> STRIPE
  BE --> OBS
```

## 2) Frontend/backend interaction

```mermaid
sequenceDiagram
  autonumber
  participant User as User Browser
  participant FE as Frontend SPA
  participant BE as Backend API
  participant Redis as Redis Cache
  participant PG as PostgreSQL

  User->>FE: Open dashboard route
  FE->>BE: GET /api/v1/financials/summary\nwith credentials
  BE->>Redis: Read cached summary by tenant + params
  alt Cache hit
    Redis-->>BE: Cached aggregate
  else Cache miss
    BE->>PG: Query tenant-scoped aggregates
    PG-->>BE: Result rows
    BE->>Redis: Write cache with TTL
  end
  BE-->>FE: JSON response envelope
  FE-->>User: Render KPI cards + charts
```

## 3) Database interaction flow

```mermaid
flowchart LR
  subgraph API[Backend Service Layer]
    RT[Routes]
    CT[Controllers]
    SV[Domain Services]
    DAL[DB/Cache Access Layer]
  end

  subgraph Data[Data Tier]
    PG[(PostgreSQL)]
    RD[(Redis)]
  end

  RT --> CT --> SV --> DAL
  DAL -->|Transactional reads/writes| PG
  DAL -->|Cache read/write| RD
  PG -->|Durable source of truth| DAL
  RD -->|Low-latency hot data| DAL
```

## 4) Authentication flow

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant FE as Frontend
  participant BE as Backend
  participant PG as PostgreSQL

  B->>FE: Submit login form
  FE->>BE: POST /api/v1/auth/login
  BE->>PG: Validate user + tenant membership
  PG-->>BE: User + role + auth factors
  BE-->>B: Set HttpOnly access/refresh cookies\nSet csrf_token cookie

  B->>FE: Navigate protected page
  FE->>BE: GET /api/v1/financials/summary\nCookie + x-csrf-token (unsafe methods)
  BE->>BE: Verify JWT issuer/audience/algorithm
  BE->>BE: Enforce tenant context + plan access
  BE-->>FE: Authorized data response

  alt Access token expired
    FE->>BE: POST /api/v1/auth/refresh
    BE-->>B: Rotate access/refresh cookies
  end
```

## 5) CI/CD pipeline

```mermaid
flowchart TD
  DEV[Developer Commit / PR] --> CI[CI Pipeline]

  subgraph CIStages[Continuous Integration]
    LINT[Lint + Type Checks]
    TEST[Unit + Integration + E2E Gates]
    SEC[Security / Evidence Gates]
    BUILD[Build Artifacts + Images]
  end

  CI --> LINT --> TEST --> SEC --> BUILD

  BUILD --> STG[Deploy to Staging]
  STG --> SMOKE[Smoke + Readiness Checks]
  SMOKE --> APPROVAL[Manual or Policy Approval]
  APPROVAL --> PROD[Deploy to Production]
  PROD --> MON[Monitoring + Alerts + Rollback Hooks]
```

## 6) Docker container topology

```mermaid
flowchart TB
  subgraph Host[Docker Host / VPC Node]
    subgraph Net[medfinance network]
      FE[frontend container\nPort 3000]
      BE[backend container\nPort 3001]
      PG[(postgres container\nPort 5432)]
      RD[(redis container\nPort 6379)]
      NGINX[nginx reverse proxy\nEdge routing]
    end
  end

  Client[Browser / API Client] -->|HTTP/HTTPS| NGINX
  NGINX --> FE
  NGINX -->|/api/v1| BE
  BE --> PG
  BE --> RD
```

## 7) Request lifecycle

```mermaid
flowchart LR
  REQ[Incoming Request] --> RID[Request ID + Context]
  RID --> SEC[Security Middleware\nHelmet CORS Rate Limit CSRF]
  SEC --> VAL[Input Validation + Sanitization]
  VAL --> AUTH[AuthN/AuthZ + Tenant Context]
  AUTH --> ROUTE[Route Handler]
  ROUTE --> SVC[Service Layer Logic]
  SVC --> DATA[PostgreSQL / Redis]
  DATA --> RESP[Response Envelope]
  RESP --> LOG[Structured Logging + Tracing]
  LOG --> OUT[Client Response]

  ERR[Exception] --> EH[Central Error Handler]
  EH --> LOG
  EH --> OUT
```

## 8) Health check and readiness flow

```mermaid
sequenceDiagram
  autonumber
  participant LB as Load Balancer / Orchestrator
  participant BE as Backend
  participant PG as PostgreSQL
  participant RD as Redis
  participant MON as Monitoring

  LB->>BE: GET /api/v1/health/live
  BE-->>LB: 200 alive (process running)

  LB->>BE: GET /api/v1/health/ready
  BE->>PG: Connectivity probe
  BE->>RD: Connectivity probe

  alt All dependencies healthy
    BE-->>LB: 200 ready
    MON-->>MON: Service healthy
  else Any dependency degraded
    BE-->>LB: 503 not ready
    MON-->>MON: Trigger alert + incident workflow
  end
```
