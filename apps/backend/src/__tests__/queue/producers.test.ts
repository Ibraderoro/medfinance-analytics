const mockAdd = jest.fn();

class MockQueue {
  public readonly name: string;
  public add = mockAdd;
  public close = jest.fn();
  public getJobCounts = jest.fn();

  constructor(name: string) {
    this.name = name;
  }
}

jest.mock('bullmq', () => ({ Queue: MockQueue }));
jest.mock('../../config/queueRedis', () => ({
  getQueueRedisConnection: () => ({}),
}));

import { enqueueWebhookProcessing } from '../../queue/producers';
import { QUEUE_NAMES } from '../../queue/queues';

describe('enqueueWebhookProcessing', () => {
  beforeEach(() => {
    mockAdd.mockReset();
    mockAdd.mockResolvedValue(undefined);
  });

  it('enqueues onto the billing webhook queue using the Stripe event id as the BullMQ jobId', async () => {
    await enqueueWebhookProcessing({ id: 'evt_123', type: 'invoice.paid', data: { object: { foo: 'bar' } } });

    expect(mockAdd).toHaveBeenCalledTimes(1);
    const [jobName, payload, options] = mockAdd.mock.calls[0];
    expect(jobName).toBe('process');
    expect(payload).toEqual({ id: 'evt_123', type: 'invoice.paid', data: { object: { foo: 'bar' } } });
    expect(options).toEqual(expect.objectContaining({
      jobId: 'evt_123',
      attempts: expect.any(Number),
      backoff: expect.objectContaining({ type: 'exponential' }),
    }));
  });

  it('always targets the billing:webhook-processing queue', async () => {
    await enqueueWebhookProcessing({ id: 'evt_456', type: 'customer.subscription.deleted' });

    // MockQueue instances record their own name; getQueue() is memoized per
    // name so this is the only Queue instance created for this queue name.
    expect(QUEUE_NAMES.BILLING_WEBHOOK).toBe('billing.webhook-processing');
  });

  it('a duplicate enqueue for the same event id passes the same jobId again (BullMQ dedupes by jobId)', async () => {
    await enqueueWebhookProcessing({ id: 'evt_dup', type: 'invoice.paid' });
    await enqueueWebhookProcessing({ id: 'evt_dup', type: 'invoice.paid' });

    expect(mockAdd).toHaveBeenCalledTimes(2);
    expect(mockAdd.mock.calls[0][2]).toEqual(expect.objectContaining({ jobId: 'evt_dup' }));
    expect(mockAdd.mock.calls[1][2]).toEqual(expect.objectContaining({ jobId: 'evt_dup' }));
  });
});
