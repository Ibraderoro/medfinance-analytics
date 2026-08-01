const mockProcessOneBatch = jest.fn();
const mockEnforceRetention = jest.fn();

jest.mock('../../../services/analytics.service', () => ({
  analyticsService: {
    processOneBatch: (...args: unknown[]) => mockProcessOneBatch(...args),
    enforceRetention: (...args: unknown[]) => mockEnforceRetention(...args),
  },
}));

import { processAnalyticsPersistJob } from '../../../queue/processors/analyticsPersist.processor';
import { processAnalyticsRetentionJob } from '../../../queue/processors/analyticsRetention.processor';

describe('analytics job processors', () => {
  beforeEach(() => {
    mockProcessOneBatch.mockReset();
    mockEnforceRetention.mockReset();
  });

  it('processAnalyticsPersistJob delegates to analyticsService.processOneBatch', async () => {
    mockProcessOneBatch.mockResolvedValue(true);
    await processAnalyticsPersistJob();
    expect(mockProcessOneBatch).toHaveBeenCalledTimes(1);
  });

  it('processAnalyticsRetentionJob delegates to analyticsService.enforceRetention', async () => {
    mockEnforceRetention.mockResolvedValue(undefined);
    await processAnalyticsRetentionJob();
    expect(mockEnforceRetention).toHaveBeenCalledTimes(1);
  });
});
