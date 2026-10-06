# Real-Time Dashboards + AI Assistant Plan

## Top-Level Overview

**Goal:** Transform all four dashboards (Overview, Financials, Forecasting, Compliance) from
static snapshots into live, auto-refreshing views, and add an AI assistant that users can
query from any page for summaries, reports, and financial recommendations.

**Approach:**
1. Extend the existing SSE infrastructure to cover all dashboard endpoints (not just financials/live).
2. Upgrade frontend data hooks to auto-poll on a configurable interval and respond to SSE push events.
3. Introduce a new `/api/v1/ai` backend route backed by the OpenAI API (`gpt-4o-mini`).
4. Build a floating AI chat panel in the frontend accessible from every protected page.
5. Wire the AI context to live financial data so the model always reasons over current numbers.

**What is NOT in scope:**
- Replacing existing rule-based InsightsService (it stays and feeds AI context)
- Changing authentication, billing, or database schema beyond what's needed
- Migrating from SSE to WebSockets
- Adding streaming token-by-token AI responses (simple request/response is sufficient)

**LLM Provider:** OpenAI API — `gpt-4o-mini` (cost-efficient default, `gpt-4o` configurable via env)

---

## Sub-Tasks

---

### Sub-Task 1 — Backend: Extend SSE to All Dashboard Domains

**Status:** [x] done

**Intent:**
The existing `LiveFinancialsService` only publishes `transaction-added` and `forecast-changed`
events. Compliance data changes (new alerts, status updates) and forecast recalculations are
currently never pushed. This sub-task broadens the SSE channel to carry typed events for
all dashboard domains so the frontend can react to any data change without polling.

**Expected Outcomes:**
- The Redis Pub/Sub channel `medfinance:financials:live-events` is renamed/extended to
  `medfinance:live-events` (or a second channel is added) carrying typed event envelopes.
- New event types added: `compliance-updated`, `kpi-updated`, `forecast-updated`.
- `LiveFinancialsService` (or a new `LiveEventsService`) publishes these new event types.
- New internal POST endpoints allow services/workers to trigger these events:
  - `POST /financials/live/events/kpi-updated`
  - `POST /compliance/live/events/compliance-updated`
  - `POST /forecasting/live/events/forecast-updated`
- Existing SSE client connection path (`GET /financials/live`) is preserved for backward compat.

**Todo List:**
1. Rename/extend the Redis channel in `LiveFinancialsService` to handle a broader event envelope type.
2. Add `publishKpiUpdated`, `publishComplianceUpdated`, `publishForecastUpdated` methods to the service.
3. Add the three new POST route handlers in the relevant route files and controllers.
4. Update the shared `packages/shared/` types to include the new event payload shapes.
5. Write unit tests for the new publish methods.

**Relevant Context:**
- `apps/backend/src/services/liveFinancialsService.ts` — existing SSE pub/sub logic
- `apps/backend/src/controllers/financialsLive.controller.ts` — existing publish controller
- `apps/backend/src/routes/financials.ts` — existing live event routes
- `apps/backend/src/routes/compliance.ts`, `apps/backend/src/routes/forecasting.ts`
- `packages/shared/` — shared type definitions

---

### Sub-Task 2 — Backend: Auto-Invalidate Cache and Publish Live Events on Data Write

**Status:** [x] done

**Intent:**
Currently, cached financial aggregates are never invalidated after a transaction is created or
KPIs are recomputed. Real-time dashboards require that any write to `transactions`,
`compliance_items`, or `financial_kpis` automatically (a) busts the relevant Redis cache keys
and (b) publishes the appropriate live event so connected SSE clients are notified immediately.

**Expected Outcomes:**
- `FinancialsService` cache keys are busted whenever a write operation occurs (even from the
  worker/queue pipeline that recomputes KPIs).
- After cache bust, the relevant live event is published via `LiveEventsService`.
- A new internal `POST /api/internal/events/kpi-recomputed` endpoint (or a queue job hook)
  triggers invalidation from the worker process.
- No new database tables; only Redis key management changes.

**Todo List:**
1. Audit all cache keys written by `FinancialsService` and `ComplianceService`; document their patterns.
2. Add a `invalidateOrgCache(orgId)` helper to `CacheService`.
3. Call `invalidateOrgCache` + `publishKpiUpdated` from the analytics persist job after a KPI write.
4. Add the same invalidation path to `ComplianceService` when compliance status changes.
5. Verify cache TTL behaviour still applies when no write has occurred (fallback path unchanged).

**Relevant Context:**
- `apps/backend/src/utils/cache.ts` — CacheService implementation
- `apps/backend/src/services/financials.service.ts` — cache key patterns
- `apps/backend/src/queue/processors/` — analytics persist job where KPI writes happen
- `apps/backend/src/services/liveFinancialsService.ts` — publish methods from Sub-Task 1

---

### Sub-Task 3 — Frontend: Upgrade Data Hooks to Real-Time Auto-Refresh

**Status:** [x] done

**Intent:**
All four dashboard pages (Dashboard, Financials, Forecasting, Compliance) use manual
`useEffect + useState` hooks with a one-shot fetch. They need to (a) re-fetch automatically
on a configurable polling interval as a baseline and (b) immediately re-fetch when the SSE
stream delivers a relevant event — giving users live updates without manual page refreshes.

**Expected Outcomes:**
- `useFinancials`, `useForecasting`, `useCompliance`, and `useFinancialKpis` each accept an
  optional `liveRefresh: boolean` flag (default `true`) and re-fetch on SSE events.
- A new shared `useAutoRefresh(fetchFn, intervalMs)` utility hook handles the polling timer
  and clears it on unmount — reused across all four hooks.
- The `useLiveFinancials` SSE hook is extended to dispatch the new event types from Sub-Task 1.
- Dashboard UI shows a subtle "Live" indicator badge when SSE is connected,
  and a "Last updated: X seconds ago" timestamp on each KPI card.
- All existing cancellation/cleanup logic is preserved.

**Todo List:**
1. Create `apps/frontend/src/hooks/useAutoRefresh.ts` — generic polling + SSE trigger hook.
2. Update `useFinancials.ts` to call `useAutoRefresh` and subscribe to `kpi-updated` SSE events.
3. Update `useForecasting.ts` to subscribe to `forecast-updated` SSE events.
4. Update `useCompliance.ts` to subscribe to `compliance-updated` SSE events.
5. Update `useFinancialKpis.ts` similarly.
6. Extend `useLiveFinancials.ts` to handle the new event types from Sub-Task 1.
7. Add "Live" badge component to the shared components directory.
8. Add "Last updated" timestamp to Dashboard KPI cards and page headers.
9. Update Financials, Forecasting, and Compliance page headers with the same timestamp.

**Relevant Context:**
- `apps/frontend/src/hooks/useLiveFinancials.ts` — existing SSE hook (lines 44-102)
- `apps/frontend/src/hooks/useFinancials.ts` — cancel flag pattern (lines 25-103)
- `apps/frontend/src/hooks/useForecasting.ts` — (lines 24-62)
- `apps/frontend/src/hooks/useCompliance.ts`
- `apps/frontend/src/components/Dashboard/Dashboard.tsx` — KPI cards (lines 1-64)
- `apps/frontend/src/pages/` — Financials.tsx, Forecasting.tsx, Compliance.tsx

---

### Sub-Task 4 — Backend: AI Service and `/api/v1/ai` Route

**Status:** [x] done

**Intent:**
Introduce a backend AI layer that accepts a user question, assembles a financial context
snapshot (current KPIs, insights, compliance status, forecast), sends it to OpenAI
`gpt-4o-mini`, and returns a structured response containing a narrative answer,
key data points referenced, and optionally a list of recommendations.

The backend handles the LLM call — never the frontend — so the OpenAI API key is never
exposed to the browser, and tenant isolation is enforced before any data is included
in the prompt.

**Expected Outcomes:**
- New `AiService` at `apps/backend/src/services/ai.service.ts`:
  - `buildContext(orgId)` — assembles KPIs, insights, compliance summary, forecast into a
    prompt-safe JSON object (numbers only, no PII).
  - `ask(orgId, question, conversationHistory)` — sends system prompt + context + history
    to OpenAI, returns `{ answer, recommendations, contextUsed }`.
- New route `POST /api/v1/ai/ask` — authenticated (viewer+), validates body (`question`,
  optional `history` array), calls `AiService.ask`, returns response.
- New route `GET /api/v1/ai/summary` — returns a pre-generated "weekly summary" without
  a user question (scheduled or on-demand).
- `OPENAI_API_KEY` and `OPENAI_MODEL` (default `gpt-4o-mini`) added to env schema and
  `.env.example`.
- The `openai` npm package is added to `apps/backend/package.json`.
- Audit log entry written for every AI request (action: `ai-query`, entity: `ai-session`).

**Todo List:**
1. Add `openai` package to `apps/backend/package.json`.
2. Add `OPENAI_API_KEY` and `OPENAI_MODEL` to `apps/backend/.env.example` and env validation.
3. Create `apps/backend/src/services/ai.service.ts` with `buildContext` and `ask` methods.
4. Write a system prompt template that instructs the model to act as a financial analyst
   for a healthcare finance platform, using only the supplied context data.
5. Create `apps/backend/src/controllers/ai.controller.ts` with `askAi` and `getSummary` handlers.
6. Create `apps/backend/src/routes/ai.ts` with POST `/ask` and GET `/summary` routes.
7. Register the `aiRouter` in `apps/backend/src/routes/index.ts`.
8. Add audit logging for AI queries via `AuditService`.
9. Add rate limiting specific to the AI endpoint (e.g. 20 requests/minute per org).

**Relevant Context:**
- `apps/backend/src/services/insights.service.ts` — existing rule-based insights to reuse as AI context
- `apps/backend/src/services/financials.service.ts` — KPI data source
- `apps/backend/src/services/compliance.service.ts` — compliance data source
- `apps/backend/src/services/forecasting.service.ts` — forecast data source
- `apps/backend/src/routes/index.ts` — router registration (lines 1-23)
- `apps/backend/src/controllers/` — controller pattern to follow
- `apps/backend/src/utils/auditService.ts` — audit logging

---

### Sub-Task 5 — Frontend: Floating AI Chat Panel

**Status:** [x] done

**Intent:**
Build a floating chat panel (bottom-right drawer) accessible from every protected page.
Users can type natural language questions ("What drove the revenue spike in March?",
"Summarize this month's compliance risk", "What should I do to improve cash flow?") and
receive AI-generated answers grounded in their live financial data. The panel persists
conversation history within the session and can be minimized without losing context.

**Expected Outcomes:**
- New `AiChatPanel` component at `apps/frontend/src/components/AiChat/AiChatPanel.tsx`.
- A floating action button (bottom-right) opens/closes the panel on all protected pages.
- The panel shows a conversation thread: user messages + AI responses with markdown rendering.
- A "Generate Summary" quick-action button at the top calls `GET /api/v1/ai/summary` and
  displays the result as the first message.
- Loading state shows a typing indicator while awaiting the AI response.
- Error state shows a user-friendly message if the AI call fails.
- Conversation history (max last 10 turns) is kept in local component state and sent with
  each subsequent message for context continuity.
- A Zustand `aiStore` tracks `isOpen`, `messages`, and `isLoading` state — accessible from
  any page without prop drilling.
- The panel is rendered in the root protected layout so it appears across all dashboard pages.

**Todo List:**
1. Add `aiApi.ask(question, history)` and `aiApi.getSummary()` to `apps/frontend/src/services/api.ts`.
2. Create `apps/frontend/src/store/aiStore.ts` (Zustand) with `isOpen`, `messages`, `isLoading`.
3. Create `apps/frontend/src/components/AiChat/AiChatPanel.tsx` — panel shell with open/close toggle.
4. Create `apps/frontend/src/components/AiChat/ChatMessage.tsx` — renders a single message
   (user vs. AI bubble, with basic markdown-to-HTML for bullet lists and bold).
5. Create `apps/frontend/src/components/AiChat/ChatInput.tsx` — textarea + send button,
   Enter to send, Shift+Enter for newline.
6. Add the floating toggle button and `<AiChatPanel />` to the protected layout component.
7. Add a "Generate Summary" button inside the panel header.
8. Wire up `aiStore` actions to the API calls with proper loading/error handling.
9. Ensure the panel is responsive: full-height drawer on mobile, fixed sidebar on desktop.

**Relevant Context:**
- `apps/frontend/src/store/authStore.ts` — Zustand store pattern to follow
- `apps/frontend/src/services/api.ts` — Axios API client (lines 1-97)
- Protected layout component (likely `apps/frontend/src/components/Layout/` or root router file)
- `apps/frontend/src/pages/` — pages where the panel will appear

---

### Sub-Task 6 — Frontend: AI Recommendations Panel on Dashboard

**Status:** [x] done

**Intent:**
Surface AI-generated recommendations directly on the Dashboard overview page in a dedicated
card, so users who don't actively use the chat panel still benefit from AI insight.
The card auto-fetches a summary on page load and shows 3–5 bullet-point recommendations.

**Expected Outcomes:**
- A new `AiRecommendations` card on the Dashboard overview page (below the KPI cards).
- On mount it calls `GET /api/v1/ai/summary` and displays the `recommendations` array as
  a styled bullet list.
- Shows a skeleton/loading state while fetching.
- Has a "Refresh" icon button that re-fetches the summary on demand.
- Recommendations are tagged with severity (info / warning / critical) matching the
  existing risk_level logic from `InsightsService`.

**Todo List:**
1. Create `apps/frontend/src/components/Dashboard/AiRecommendations.tsx`.
2. Create `apps/frontend/src/hooks/useAiSummary.ts` — fetches summary, exposes
   `{ summary, recommendations, isLoading, error, refetch }`.
3. Add `AiRecommendations` to `apps/frontend/src/components/Dashboard/Dashboard.tsx`
   below the existing KPI cards row.
4. Style the recommendation items with color-coded severity badges
   (green=info, amber=warning, red=critical) consistent with the existing Compliance chart palette.

**Relevant Context:**
- `apps/frontend/src/components/Dashboard/Dashboard.tsx` — insertion point (lines 1-64)
- `apps/frontend/src/hooks/` — hook patterns to follow
- `apps/frontend/src/services/api.ts` — `insightsApi.getInsights()` as reference
- Existing `ComplianceChart` color palette for severity badge consistency

---

### Sub-Task 7 — Environment, Documentation, and Migration Notes

**Status:** [x] done

**Intent:**
Ensure the new features are properly documented, environment variables are validated at
startup, and a developer can get real-time + AI running locally in one step.

**Expected Outcomes:**
- `apps/backend/.env.example` updated with `OPENAI_API_KEY`, `OPENAI_MODEL`,
  `AI_RATE_LIMIT_MAX` (default 20), `LIVE_POLL_INTERVAL_MS` (default 30000).
- Backend startup validates that `OPENAI_API_KEY` is set when `NODE_ENV=production`;
  in development it can be absent (AI endpoints return a graceful "not configured" response).
- `README.md` or `docs/` updated with a "Real-Time & AI" section explaining the new
  SSE events, AI endpoints, and required env vars.
- `docker-compose.yml` does not need changes (Redis and Postgres already present).

**Todo List:**
1. Add the four new env vars to `apps/backend/.env.example` with comments.
2. Add validation for `OPENAI_API_KEY` in the backend env validation module.
3. Add graceful degradation in `AiService`: if key is absent, return a
   `{ answer: "AI assistant is not configured.", recommendations: [] }` response.
4. Update `docs/` or root `README.md` with the new feature setup instructions.

**Relevant Context:**
- `apps/backend/.env.example` — existing env var documentation
- Backend env validation module (likely `apps/backend/src/config/env.ts` or similar)
- `README.md` or `docs/` directory

---

## Implementation Order

```
Sub-Task 1 (SSE extension)
    → Sub-Task 2 (cache invalidation + publish)
        → Sub-Task 3 (frontend real-time hooks)
Sub-Task 4 (AI backend)
    → Sub-Task 5 (AI chat panel)
        → Sub-Task 6 (AI recommendations card)
Sub-Task 7 (env + docs) — can run in parallel with Sub-Task 5/6
```

Sub-Tasks 1–3 are the real-time track.
Sub-Tasks 4–6 are the AI track.
Both tracks can be developed in parallel after Sub-Task 1 is done.
Sub-Task 7 closes the work.
