# MedFinance Analytics Database Schema

## 1) Overview

The platform uses PostgreSQL as the source of truth for tenant identity, users, financial activity, budgeting, compliance tracking, and audit history.

Notable extensions:

- `uuid-ossp` for UUID primary keys.
- `pg_trgm` enabled for future text search/index optimization.

## 2) Entity Relationship Summary

```text
organisations (1) ────────< users
      │                      │
      │                      └─────< compliance_items.assigned_to (optional)
      │
      ├──────────< financial_transactions
      ├──────────< budgets
      ├──────────< compliance_items
      ├──────────< regulatory_alerts
      └──────────< audit_log

users (1) ────────< audit_log.performed_by (optional)
```

## 3) Tables

### `organisations`
- **Purpose**: Multi-tenant boundary and ownership root.
- **Primary key**: `id UUID`.
- **Important columns**:
  - `name`
  - `slug` (unique)
  - `created_at`, `updated_at`

### `users`
- **Purpose**: Application identities and role-based access.
- **Primary key**: `id UUID`.
- **Foreign keys**:
  - `organisation_id → organisations(id)` (`ON DELETE CASCADE`)
- **Constraints**:
  - `email` unique
  - role check: `cfo | finance_manager | auditor | viewer`
- **Metadata**: `is_active`, timestamps.

### `financial_transactions`
- **Purpose**: Ledger-like store of revenues and expenses.
- **Primary key**: `id UUID`.
- **Foreign keys**:
  - `organisation_id → organisations(id)` (`ON DELETE CASCADE`)
- **Constraints**:
  - type check: `revenue | expense`
  - `amount NUMERIC(18,2)`
- **Analytical columns**:
  - `category`, `transaction_date`, `reference_number`
- **Indexes**:
  - `organisation_id`, `transaction_date`, `type`

### `budgets`
- **Purpose**: Category-level budgeting by fiscal year.
- **Primary key**: `id UUID`.
- **Foreign keys**:
  - `organisation_id → organisations(id)` (`ON DELETE CASCADE`)
- **Constraints**:
  - unique composite key `(organisation_id, category, fiscal_year)`

### `compliance_items`
- **Purpose**: Compliance control checklist by regulation.
- **Primary key**: `id UUID`.
- **Foreign keys**:
  - `organisation_id → organisations(id)` (`ON DELETE CASCADE`)
  - `assigned_to → users(id)` (nullable)
- **Constraints**:
  - status check: `compliant | non_compliant | under_review`

### `regulatory_alerts`
- **Purpose**: Time-sensitive compliance alerts with severity and lifecycle status.
- **Primary key**: `id UUID`.
- **Foreign keys**:
  - `organisation_id → organisations(id)` (`ON DELETE CASCADE`)
- **Constraints**:
  - severity check: `critical | high | medium | low`
  - status check: `open | acknowledged | resolved` (default `open`)

### `audit_log`
- **Purpose**: Immutable-style event stream for actions performed on domain entities.
- **Primary key**: `id BIGSERIAL`.
- **Foreign keys**:
  - `organisation_id → organisations(id)` (`ON DELETE SET NULL`)
  - `performed_by → users(id)` (`ON DELETE SET NULL`)
- **Important columns**:
  - `action`, `entity_type`, `entity_id`, `performed_at`, `metadata JSONB`
- **Indexes**:
  - `organisation_id`
  - descending `performed_at`

## 4) Query Patterns Supported by Current Services

- **Financial summary**: annual aggregates split by transaction type.
- **Revenue/expense trends**: month-based grouping by date range.
- **Cash-flow trend**: signed monthly aggregation (revenue positive, expense negative).
- **Budget variance**: joins `budgets` with `financial_transactions` on category and fiscal year.
- **Compliance monitoring**: due-date sorted status records.
- **Audit browsing**: paginated timeline with total count.
- **Alert triage**: severity-filtered retrieval with deterministic severity ordering.

## 5) Data Governance Considerations

- Tenant separation is encoded via `organisation_id` across core domain tables.
- Auditability is provided through dedicated `audit_log` with JSONB metadata for extensibility.
- Enumerated checks protect status/severity/role data integrity at the schema level.


### `customers`
- **Purpose**: Maps each organization to its Stripe customer profile.
- **Primary key**: `id UUID`.
- **Foreign keys**:
  - `organization_id -> organizations(id)` (`ON DELETE CASCADE`)
- **Constraints**:
  - `organization_id` unique (one Stripe customer per tenant)
  - `stripe_customer_id` unique

### `subscriptions`
- **Purpose**: Stores Stripe subscription lifecycle and active plan.
- **Primary key**: `id UUID`.
- **Foreign keys**:
  - `organization_id -> organizations(id)` (`ON DELETE CASCADE`)
  - `customer_id -> customers(id)` (`ON DELETE CASCADE`)
- **Constraints**:
  - `plan` check: `free | pro | enterprise`
  - `stripe_subscription_id` unique
- **Tracked fields**:
  - `status`, `current_period_start`, `current_period_end`, timestamps
