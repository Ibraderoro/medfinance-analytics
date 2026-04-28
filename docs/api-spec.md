# MedFinance Analytics API Specification (v1)

## 1) API Conventions

- **Base path**: `/api/v1`
- **Format**: JSON request/response bodies.
- **Authentication**:
  - `/health` is public.
  - `/financials/*`, `/forecasting/*`, and `/compliance/*` require `Authorization: Bearer <JWT>`.
- **Error behavior**:
  - Invalid/missing bearer token returns `401`.
  - Health endpoint may return `503` if dependencies are degraded.

## 2) Endpoint Overview

| Domain | Method | Path | Auth | Purpose |
|---|---|---|---|---|
| Health | GET | `/health` | No | Service/dependency liveness |
| Financials | GET | `/financials/summary` | Yes | Year-level revenue/expense/net summary |
| Financials | GET | `/financials/revenue` | Yes | Revenue trend by month |
| Financials | GET | `/financials/expenses` | Yes | Expense trend by category/month |
| Financials | GET | `/financials/cash-flow` | Yes | Net cash flow by month |
| Forecasting | GET | `/forecasting/forecast` | Yes | Forecast payload from historical trend |
| Forecasting | GET | `/forecasting/budget-variance` | Yes | Budget vs actual variance by category |
| Compliance | GET | `/compliance/status` | Yes | Compliance item statuses |
| Compliance | GET | `/compliance/audit-log` | Yes | Paginated audit events |
| Compliance | GET | `/compliance/alerts` | Yes | Regulatory alerts with optional severity filter |
| Insights | GET | `/insights` | Yes (Pro+) | Financial health score, risk level, and explainable insights |
| Billing | GET | `/billing/subscription` | Yes | Current organization plan/status |
| Billing | POST | `/billing/subscription` | Yes | Create paid Stripe subscription (Pro or Enterprise) |
| Billing | POST | `/billing/webhook` | No (Stripe signature) | Stripe webhook receiver for payment + subscription updates |

---

## 3) Endpoint Details

### 3.1 Health

#### `GET /api/v1/health`
Checks PostgreSQL and Redis connectivity.

**Response 200/503**
```json
{
  "status": "healthy",
  "timestamp": "2026-04-25T00:00:00.000Z",
  "services": {
    "postgres": "ok",
    "redis": "ok"
  }
}
```

---

### 3.2 Financials

#### `GET /api/v1/financials/summary`
Returns annual aggregate totals.

**Query params**
- `period` (optional, default: `monthly`)
- `year` (optional, default: current year)

**Response 200**
```json
{
  "data": {
    "total_revenue": "1250000.00",
    "total_expenses": "910000.00",
    "net_income": "340000.00"
  }
}
```

#### `GET /api/v1/financials/revenue`
Returns monthly revenue totals.

**Query params**
- `startDate` (optional, `YYYY-MM-DD`)
- `endDate` (optional, `YYYY-MM-DD`)

**Response 200**
```json
{
  "data": [
    { "month": "2026-01-01T00:00:00.000Z", "total": "120000.00" }
  ]
}
```

#### `GET /api/v1/financials/expenses`
Returns monthly expense totals grouped by category.

**Query params**
- `startDate` (optional)
- `endDate` (optional)

**Response 200**
```json
{
  "data": [
    {
      "category": "staffing",
      "total": "75000.00",
      "month": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

#### `GET /api/v1/financials/cash-flow`
Returns monthly net cash flow.

**Query params**
- `startDate` (optional)
- `endDate` (optional)

**Response 200**
```json
{
  "data": [
    {
      "month": "2026-01-01T00:00:00.000Z",
      "net_cash_flow": "45000.00"
    }
  ]
}
```

---

### 3.3 Forecasting

#### `GET /api/v1/forecasting/forecast`
Provides metric-based forecast metadata with recent actuals.

**Query params**
- `months` (optional, default: `12`)
- `metric` (optional, default: `revenue`; currently mapped to financial transaction type)

**Response 200**
```json
{
  "data": {
    "metric": "revenue",
    "forecastMonths": 12,
    "actuals": [
      { "month": "2025-12-01T00:00:00.000Z", "total": "118000.00" }
    ]
  }
}
```

#### `GET /api/v1/forecasting/budget-variance`
Compares budgeted and actual amounts by category for a fiscal year.

**Query params**
- `year` (optional, default: current year)

**Response 200**
```json
{
  "data": [
    {
      "category": "operations",
      "budgeted_amount": "500000.00",
      "actual_amount": "470000.00",
      "variance": "30000.00"
    }
  ]
}
```

---

### 3.4 Compliance

#### `GET /api/v1/compliance/status`
Returns compliance records ordered by next review due date.

**Response 200**
```json
{
  "data": [
    {
      "regulation_code": "HIPAA-164.312",
      "status": "under_review",
      "last_reviewed_at": "2026-03-15T10:00:00.000Z",
      "next_review_due_at": "2026-06-15T00:00:00.000Z",
      "assigned_to": "uuid-user"
    }
  ]
}
```

#### `GET /api/v1/compliance/audit-log`
Returns paginated audit events.

**Query params**
- `page` (optional, default: `1`)
- `limit` (optional, default: `50`)

**Response 200**
```json
{
  "data": {
    "items": [
      {
        "id": 101,
        "action": "UPDATE",
        "entity_type": "compliance_item",
        "entity_id": "uuid-entity",
        "performed_by": "uuid-user",
        "performed_at": "2026-04-25T10:10:00.000Z",
        "metadata": { "field": "status", "from": "non_compliant", "to": "compliant" }
      }
    ],
    "total": 482,
    "page": 1,
    "limit": 50
  }
}
```

#### `GET /api/v1/compliance/alerts`
Returns alerts, optionally filtered by severity.

**Query params**
- `severity` (optional: `critical|high|medium|low`)

**Response 200**
```json
{
  "data": [
    {
      "id": "uuid-alert",
      "title": "Encryption control gap",
      "description": "Encryption policy review overdue for PHI backup store.",
      "severity": "high",
      "regulation_code": "HIPAA-164.312(a)(2)(iv)",
      "due_date": "2026-05-10",
      "status": "open"
    }
  ]
}
```

### 3.5 Insights

#### `GET /api/v1/insights`
Returns an explainable business-health assessment derived from recent monthly KPIs.

**Response 200**
```json
{
  "health_score": 78,
  "risk_level": "medium",
  "insights": [
    "Profitability averaged 18.2% over the last 6 months, contributing 94 points in the score model.",
    "Expense ratio averaged 66.5% of revenue; lower ratios improve resilience and contributed 67 points.",
    "Revenue growth averaged 4.3% month-over-month, contributing 46 points to forward-looking health."
  ]
}
```

---

## 4) Data Flow Diagram (Text-Based)

```text
Client (React) 
   │  GET /api/v1/... + Bearer JWT
   ▼
Express Router
   │  route match + auth middleware (protected groups)
   ▼
Controller
   │  parse query params / defaults
   ▼
Service Layer
   │  SQL queries (PostgreSQL) and optional Redis cache reads/writes
   ▼
Controller
   │  wraps into { data: ... }
   ▼
JSON Response
```

## 5) Security Notes for Integrators

- Include `Authorization: Bearer <token>` for all non-health endpoints.
- Token expiry or invalid signature results in `401` and should trigger client-side re-authentication.
- Respect API timeout expectations (frontend client defaults to 15 seconds).


### 3.6 Billing

#### `GET /api/v1/billing/subscription`
Returns the current subscription snapshot for the authenticated organization.

#### `POST /api/v1/billing/subscription`
Creates a Stripe subscription for `pro` or `enterprise`.

**Body**
```json
{ "plan": "pro" }
```

#### `POST /api/v1/billing/webhook`
Stripe webhook endpoint for:
- `invoice.payment_succeeded`
- `customer.subscription.updated`

> This endpoint requires a valid `stripe-signature` header.

### 3.7 Plan Access Rules

- **Free**: financial history endpoints require a `startDate` within the last 3 months.
- **Pro / Enterprise**: full financial history and `/insights` access.
