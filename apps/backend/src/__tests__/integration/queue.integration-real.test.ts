import { randomUUID } from 'crypto';

const mockHandleWebhookEvent = jest.fn();
const mockMarkWebhookEventProcessed = jest.fn();
const mockReleaseWebhookEventReservation = jest.fn();

jest.mock('../../services/billing.service', () => ({
  BillingService: jest.fn().mockImplementation(() => ({
    handleWebhookEvent: mockHandleWebhookEvent,
    markWebhookEventProcessed: mockMarkWebhookEventProcessed,
    releaseWebhookEventReservation: mockReleaseWebhookEventReservation,
  })),
}));

import { disconnectQueueRedis } from '../../config/queueRedis';
import { disconnectRedis } from '../../config/redis';
import { QUEUE_NAMES, getQueue, closeAllQueues } from '../../queue/queues';
import { enqueueWebhookProcessing } from '../../queue/producers';
import { registerWorkers, closeWorkers } from '../../queue/workers';

jest.setTimeout(30_000);

/**
 * Exercises the real `queue/workers.ts` registration + dead-letter routing
 * against real Redis, with only `BillingService` mocked (so no Postgres
 * connection is required here — the Stripe reservation/dedupe layer is
 * covered separately by `postgres-redis.integration-real.test.ts`).
 */
describe('BullMQ queue integration (real Redis)', () => {
  beforeAll(async () => {
    await registerWorkers();
  });

  afterAll(async () => {
    await closeWorkers();
    await closeAllQueues();
    await disconnectQueueRedis();
    // registerWorkers() calls analyticsService.reclaimPendingOnce(), which
    // connects the separate getRedis() client (used for the analytics
    // stream) — close it too or Jest hangs on an open TCP handle.
    await disconnectRedis();
  });

  beforeEach(() => {
    mockHandleWebhookEvent.mockReset();
    mockMarkWebhookEventProcessed.mockReset();
    mockReleaseWebhookEventReservation.mockReset();
  });

  it('retries a transiently-failing job and eventually completes', async () => {
    let attempts = 0;
    mockHandleWebhookEvent.mockImplementation(async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error(`transient failure #${attempts}`);
      }
    });
    mockMarkWebhookEventProcessed.mockResolvedValue(undefined);

    const eventId = `evt_retry_${randomUUID()}`;
    const queue = getQueue(QUEUE_NAMES.BILLING_WEBHOOK);
    await queue.add(
      'process',
      { id: eventId, type: 'invoice.paid' },
      { jobId: eventId, attempts: 3, backoff: { type: 'exponential', delay: 25 } },
    );

    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && mockMarkWebhookEventProcessed.mock.calls.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(attempts).toBe(3);
    expect(mockMarkWebhookEventProcessed).toHaveBeenCalledWith(eventId);
  });

  it('routes a permanently-failing job to the dead-letter queue and releases the reservation', async () => {
    mockHandleWebhookEvent.mockRejectedValue(new Error('permanent failure'));
    mockReleaseWebhookEventReservation.mockResolvedValue(undefined);

    const eventId = `evt_dlq_${randomUUID()}`;
    const queue = getQueue(QUEUE_NAMES.BILLING_WEBHOOK);
    await queue.add(
      'process',
      { id: eventId, type: 'invoice.paid' },
      { jobId: eventId, attempts: 2, backoff: { type: 'exponential', delay: 20 } },
    );

    const dlq = getQueue(`${QUEUE_NAMES.BILLING_WEBHOOK}.dlq`);
    const deadline = Date.now() + 10_000;
    let dlqJob = await dlq.getJob(eventId);
    while (!dlqJob && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      dlqJob = await dlq.getJob(eventId);
    }

    expect(dlqJob).not.toBeNull();
    expect(mockReleaseWebhookEventReservation).toHaveBeenCalledWith(eventId);

    await dlqJob?.remove();
  });

  describe('idempotent replay', () => {
    it('a duplicate enqueue for the same Stripe event id does not create a second job', async () => {
      mockHandleWebhookEvent.mockResolvedValue(undefined);
      mockMarkWebhookEventProcessed.mockResolvedValue(undefined);

      const eventId = `evt_idempotent_${randomUUID()}`;

      await enqueueWebhookProcessing({ id: eventId, type: 'invoice.paid' });
      await enqueueWebhookProcessing({ id: eventId, type: 'invoice.paid' });

      const queue = getQueue(QUEUE_NAMES.BILLING_WEBHOOK);
      const job = await queue.getJob(eventId);
      expect(job).not.toBeNull();

      // Only one handleWebhookEvent invocation should ever be attributed to
      // this event id, however many times it's re-enqueued with the same
      // jobId, since BullMQ dedupes by jobId rather than creating a second job.
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline && mockHandleWebhookEvent.mock.calls.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const callsForThisEvent = mockHandleWebhookEvent.mock.calls.filter(
        ([event]) => (event as { id?: string }).id === eventId,
      );
      expect(callsForThisEvent.length).toBe(1);

      await job?.remove();
    });
  });
});
