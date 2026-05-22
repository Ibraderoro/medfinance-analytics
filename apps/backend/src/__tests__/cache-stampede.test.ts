const mockGet = jest.fn();
const mockSetex = jest.fn();

jest.mock('../config/redis', () => ({
  getRedis: () => ({
    get: (...args: unknown[]) => mockGet(...args),
    setex: (...args: unknown[]) => mockSetex(...args),
  }),
}));

import { CacheService } from '../utils/cache';

describe('CacheService stampede protection', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockSetex.mockReset();
  });

  it('deduplicates concurrent cache misses so loader runs once', async () => {
    mockGet.mockResolvedValue(null);
    mockSetex.mockResolvedValue('OK');
    const cache = new CacheService('financials', 300);

    const loader = jest.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { total_revenue: '100.00' };
    });

    const [a, b, c] = await Promise.all([
      cache.getOrLoad('summary:org-1:2026', loader),
      cache.getOrLoad('summary:org-1:2026', loader),
      cache.getOrLoad('summary:org-1:2026', loader),
    ]);

    expect(a).toEqual({ total_revenue: '100.00' });
    expect(b).toEqual({ total_revenue: '100.00' });
    expect(c).toEqual({ total_revenue: '100.00' });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(mockSetex).toHaveBeenCalledTimes(1);
  });

  it('clears in-flight entry when loader rejects and allows retry', async () => {
    mockGet.mockResolvedValue(null);
    mockSetex.mockResolvedValue('OK');
    const cache = new CacheService('financials', 300);

    const loader = jest.fn()
      .mockImplementationOnce(async () => {
        throw new Error('first load failed');
      })
      .mockImplementationOnce(async () => ({ total_revenue: '200.00' }));

    await expect(cache.getOrLoad('summary:org-1:2026', loader)).rejects.toThrow('first load failed');
    await expect(cache.getOrLoad('summary:org-1:2026', loader)).resolves.toEqual({ total_revenue: '200.00' });

    expect(loader).toHaveBeenCalledTimes(2);
    expect(mockSetex).toHaveBeenCalledTimes(1);
  });
});
