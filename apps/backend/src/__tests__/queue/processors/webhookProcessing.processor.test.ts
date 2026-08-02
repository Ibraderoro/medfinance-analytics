import type { Job } from 'bullmq';
import type { WebhookProcessingPayload } from '../../../queue/jobs/webhookProcessing.job';

const mockHandleWebhookEvent = jest.fn();
const mockMarkWebhookEventProcessed = jest.fn();

jest.mock('../../../services/billing.service', () => ({
  BillingService: jest.fn().mockImplementation(() => ({
    handleWebhookEvent: mockHandleWebhookEvent,
    markWebhookEventProcessed: mockMarkWebhookEventProcessed,
  })),
}));

jest.mock('../../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { processWebhookJob } from '../../../queue/processors/webhookProcessing.processor';

function buildJob(overrides: Partial<Job<WebhookProcessingPayload>> = {}): Job<WebhookProcessingPayload> {
  return {
    data: { id: 'evt_1', type: 'invoice.paid' },
    attemptsMade: 0,
    opts: { attempts: 5 },
    ...overrides,
  } as unknown as Job<WebhookProcessingPayload>;
}

describe('processWebhookJob', () => {
  beforeEach(() => {
    mockHandleWebhookEvent.mockReset();
    mockMarkWebhookEventProcessed.mockReset();
  });

  it('calls handleWebhookEvent then marks the reservation processed on success', async () => {
    mockHandleWebhookEvent.mockResolvedValue(undefined);
    mockMarkWebhookEventProcessed.mockResolvedValue(undefined);

    await processWebhookJob(buildJob());

    expect(mockHandleWebhookEvent).toHaveBeenCalledWith({ id: 'evt_1', type: 'invoice.paid' });
    expect(mockMarkWebhookEventProcessed).toHaveBeenCalledWith('evt_1');
  });

  it('rethrows on a retryable failure without marking the reservation processed', async () => {
    mockHandleWebhookEvent.mockRejectedValue(new Error('db unavailable'));

    await expect(processWebhookJob(buildJob({ attemptsMade: 1 }))).rejects.toThrow('db unavailable');
    expect(mockMarkWebhookEventProcessed).not.toHaveBeenCalled();
  });
});
