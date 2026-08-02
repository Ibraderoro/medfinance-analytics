# Queue / Worker Recovery Runbook

## Purpose

Restore durable background processing handled by the standalone `worker` process (BullMQ, backed by Redis): Stripe webhook processing, analytics telemetry persistence, and analytics retention.

## Architecture Summary

- The `backend` (web) process no longer runs background jobs in-process. It only enqueues work.
- The `worker` process (`apps/backend/dist/worker.js`, its own Docker/Compose/Render service) consumes three BullMQ queues:
  - `billing.webhook-processing` — one job per Stripe event. Enqueued from `POST /api/v1/billing/webhook` after signature verification, Redis dedupe, and the Postgres reservation succeed inline.
  - `analytics.telemetry-persist` — a repeatable job (default every `ANALYTICS_PERSIST_TICK_INTERVAL_MS`) that drains one batch from the `api_telemetry_stream` Redis Stream consumer group and persists it to Postgres.
  - `analytics.retention` — a repeatable job (default every `ANALYTICS_RETENTION_SCHEDULE_MS`, ~6h) that archives and deletes `api_request_metrics` rows older than 90 days.
- **Two layers of durability for analytics telemetry**: the Redis Stream (`api_telemetry_stream`) is the actual durability layer — entries stay in the consumer group, unacked, until successfully persisted, surviving worker crashes via `XAUTOCLAIM`. BullMQ is the *scheduling and retry* layer on top (it decides when to run "drain one batch" and retries that operation on failure) — it does not itself hold the telemetry data.
- Each queue has a matching dead-letter queue: `<queue-name>.dlq` (e.g. `billing.webhook-processing.dlq`). A job that exhausts its configured `attempts` is copied there by the worker's `failed` handler, and (for the webhook queue) the Postgres `stripe_webhook_events` reservation is released so a future Stripe redelivery can retry from scratch.
- Repeatable jobs use a fixed BullMQ job-scheduler id (`analytics-persist-tick`, `analytics-retention-daily`). Restarting the worker **upserts** the existing schedule — it does not create a duplicate one.

## Symptoms

- `worker` container/service reports unhealthy (`/ready` on `WORKER_HEALTH_PORT`, default 3002).
- `queue_depth_current{state="waiting"}` climbing on the Prometheus `/metrics` endpoint (backlog not draining).
- `queue_job_dead_letter_total` increasing.
- Stripe webhooks stuck in `stripe_webhook_events.status = 'processing'` past `processing_expires_at`.
- `api_request_metrics` row count not growing despite live traffic (telemetry persistence backlog — check `XLEN api_telemetry_stream` per [Redis Recovery](./redis-recovery.md)).

## Immediate Triage

```bash
curl -fsS http://<worker-host>:3002/ready | jq .
curl -fsS https://<prod-api-host>/api/v1/internal/observability/metrics | grep -E 'queue_(depth_current|jobs_total|job_dead_letter_total)'
docker compose ps worker
docker compose logs --tail=200 worker
```

Inspect a queue's job counts directly (no UI is deployed for this — BullMQ's own Redis key namespace, `bull:<queue-name>:*`, is inspected via `redis-cli` or a short Node snippet):

```bash
redis-cli -u <redis-url> --scan --pattern 'bull:billing.webhook-processing:*' | head -50
node -e "
const { Queue } = require('bullmq');
const q = new Queue('billing.webhook-processing', { connection: { host: '<redis-host>', port: 6379, password: '<redis-password>', tls: {} } });
q.getJobCounts('waiting','active','delayed','failed','completed').then(console.log).finally(() => q.close());
"
```

## Recovery Procedures

### Path A: Worker Process Down or Unhealthy

1. Check the worker's own health endpoint and container status.
2. Confirm Postgres and Redis are reachable from the worker (both are readiness-checked at `/ready`).
3. Restart the worker service — repeatable job schedules upsert safely, no duplicate schedules result.

```bash
docker compose restart worker
```

### Path B: Backlog Growing (`queue_depth_current{state="waiting"}` climbing)

1. Confirm the worker is actually consuming (check logs for job completion, or `queue_jobs_total` increasing).
2. Scale worker concurrency for the affected queue via `WEBHOOK_QUEUE_CONCURRENCY` / `ANALYTICS_PERSIST_QUEUE_CONCURRENCY` (keep `ANALYTICS_PERSIST_QUEUE_CONCURRENCY` and `ANALYTICS_RETENTION_QUEUE_CONCURRENCY` at `1` — these are single-writer by design to avoid double-processing the same stream entries or overlapping retention passes).
3. For sustained **webhook** backlog, running additional `worker` replicas is safe — BullMQ workers on the same queue name share work across replicas. Do **not** scale worker replicas to relieve analytics backlog: every replica registers all three queues, so more replicas multiply analytics consumers too and break the single-writer guarantee, regardless of the `ANALYTICS_PERSIST_QUEUE_CONCURRENCY`/`ANALYTICS_RETENTION_QUEUE_CONCURRENCY` settings. For sustained analytics backlog, investigate the underlying cause (see Path D) rather than scaling replicas.

### Path C: Jobs Landing in a Dead-Letter Queue

1. Identify which queue via `queue_job_dead_letter_total{queue="..."}`.
2. Inspect the DLQ jobs (`<queue-name>.dlq`) to see the failed payload and confirm root cause (check worker logs around the same timestamp for the underlying error).
3. For the webhook DLQ specifically: the Postgres reservation is already released once the job lands in the DLQ. After confirming and fixing the underlying cause (from step 2's log inspection), immediately reprocess the event — either manually replay the queued DLQ job (step 4 below) or resend the event from the Stripe dashboard. Do not rely on Stripe's own automatic retries to recover this: those only cover deliveries where the webhook endpoint itself failed to return a timely 2xx — they won't fire for jobs that failed inside our own processing pipeline after we already returned 2xx.
4. To manually requeue a DLQ job immediately (only after confirming the root cause is fixed):

```bash
node -e "
const { Queue } = require('bullmq');
const conn = { host: '<redis-host>', port: 6379, password: '<redis-password>', tls: {} };
const dlq = new Queue('billing.webhook-processing.dlq', { connection: conn });
const main = new Queue('billing.webhook-processing', { connection: conn });
(async () => {
  const job = await dlq.getJob('<event-id>');
  if (job) {
    await main.add(job.name, job.data, { jobId: job.id });
    await job.remove();
  }
  await Promise.all([dlq.close(), main.close()]);
})();
"
```

### Path D: Analytics Persist Backlog (Redis Stream, not BullMQ)

See [Redis Recovery — Path D](./redis-recovery.md#path-d-analytics-stream-backlog) for `XLEN`/`XINFO GROUPS` triage. If the stream backlog is growing but the `analytics.telemetry-persist` BullMQ job shows no failures, the repeatable job's tick interval (`ANALYTICS_PERSIST_TICK_INTERVAL_MS`) or batch size (`ANALYTICS_BATCH_SIZE`) may need lowering/raising respectively.

## Repeatable Job Schedule Confusion

If an on-call engineer is unsure whether restarting the worker created duplicate repeatable schedules: it did not. `scheduleRepeatableJobs()` is called on every worker boot with a fixed job-scheduler id, which BullMQ upserts rather than duplicates. Confirm via:

```bash
node -e "
const { Queue } = require('bullmq');
const q = new Queue('analytics.telemetry-persist', { connection: { host: '<redis-host>', port: 6379, password: '<redis-password>', tls: {} } });
q.getJobSchedulers().then(console.log).finally(() => q.close());
"
```

## Escalation

Escalate to:

- SRE lead if worker downtime exceeds 15 minutes or the backlog is not draining after a restart.
- Billing/finance owner if Stripe webhook processing has been degraded for more than the Stripe webhook retry window.
- Database owner if analytics retention has not run for more than 48 hours (verify via `queue_jobs_total{queue="analytics.retention"}`).
