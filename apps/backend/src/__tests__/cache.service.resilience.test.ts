const mockGet = jest.fn();
const mockSetex = jest.fn();
const mockDel = jest.fn();
const mockScan = jest.fn();
const mockWarn = jest.fn();

jest.mock('../config/redis', () => ({
  getRedis: () => ({
    get: (...args: unknown[]) => mockGet(...args),
    setex: (...args: unknown[]) => mockSetex(...args),
    del: (...args: unknown[]) => mockDel(...args),
    scan: (...args: unknown[]) => mockScan(...args),
  }),
}));

jest.mock('../utils/logger', () => ({
  logger: {
    warn: (...args: unknown[]) => mockWarn(...args),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { CacheService } from '../utils/cache';

describe('CacheService infrastructure degradation behavior', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockSetex.mockReset();
    mockDel.mockReset();
    mockScan.mockReset();
    mockWarn.mockReset();
  });

  it('returns null and logs warning when Redis get fails', async () => {
    mockGet.mockRejectedValueOnce(new Error('redis get timeout'));
    const cache = new CacheService('financials');

    await expect(cache.get('summary:org-1')).resolves.toBeNull();
    expect(mockWarn).toHaveBeenCalledWith('Cache get error:', expect.any(Error));
  });

  it('does not throw when Redis setex fails', async () => {
    mockSetex.mockRejectedValueOnce(new Error('redis set failed'));
    const cache = new CacheService('financials');

    await expect(cache.set('summary:org-1', { total: 1 })).resolves.toBeUndefined();
    expect(mockWarn).toHaveBeenCalledWith('Cache set error:', expect.any(Error));
  });

  it('continues gracefully when Redis delete fails', async () => {
    mockDel.mockRejectedValueOnce(new Error('redis del failed'));
    const cache = new CacheService('financials');

    await expect(cache.del('summary:org-1')).resolves.toBeUndefined();
    expect(mockWarn).toHaveBeenCalledWith('Cache del error:', expect.any(Error));
  });

  it('scans/deletes namespaced keys and swallows flush failures', async () => {
    mockScan
      .mockResolvedValueOnce(['5', ['medfinance:financials:a', 'medfinance:financials:b']])
      .mockResolvedValueOnce(['0', ['medfinance:financials:c']]);
    mockDel.mockResolvedValueOnce(3);

    const cache = new CacheService('financials');
    await expect(cache.flush()).resolves.toBeUndefined();

    expect(mockScan).toHaveBeenCalledTimes(2);
    expect(mockDel).toHaveBeenCalledWith(
      'medfinance:financials:a',
      'medfinance:financials:b',
      'medfinance:financials:c',
    );

    mockScan.mockRejectedValueOnce(new Error('scan unavailable'));
    await expect(cache.flush()).resolves.toBeUndefined();
    expect(mockWarn).toHaveBeenCalledWith('Cache flush error:', expect.any(Error));
  });
});
