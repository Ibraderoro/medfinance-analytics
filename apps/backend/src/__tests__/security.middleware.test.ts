import { bruteForceProtection } from '../middleware/bruteForceProtection';
import { requirePermission } from '../middleware/rbac';

const mockTimedRedis = jest.fn();
let count = 0;

jest.mock('../config/redis', () => {
  return {
    getRedis: () => ({
      incr: async () => {
        count += 1;
        return count;
      },
      expire: async () => 1,
    }),
    timedRedis: (...args: [string, () => Promise<unknown>]) => mockTimedRedis(...args),
  };
});

describe('security middleware', () => {
  beforeEach(() => {
    count = 0;
    mockTimedRedis.mockReset();
    mockTimedRedis.mockImplementation(async (_op: string, fn: () => Promise<unknown>) => fn());
  });

  it('blocks brute-force attempts after threshold', async () => {
    const req = { ip: '127.0.0.1', body: { email: 'a@b.com', organizationId: 'org-1' } } as never;
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as { status: jest.Mock; json: jest.Mock };
    const next = jest.fn();

    for (let i = 0; i < 9; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await bruteForceProtection(req as never, res as never, next);
    }

    expect(res.status).toHaveBeenCalledWith(429);
    expect(next).toHaveBeenCalledTimes(8);
  });

  it('forwards redis failures to express error handling', async () => {
    const req = { ip: '127.0.0.1', body: { email: 'a@b.com', organizationId: 'org-1' } } as never;
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as { status: jest.Mock; json: jest.Mock };
    const next = jest.fn();
    const redisError = new Error('redis unavailable');

    mockTimedRedis.mockRejectedValueOnce(redisError);

    await bruteForceProtection(req as never, res as never, next);

    expect(next).toHaveBeenCalledWith(redisError);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('enforces permission-based RBAC', () => {
    const middleware = requirePermission('admin:read');
    const req = { user: { id: 'u1', email: 'e', role: 'viewer', organization_id: 'o1' } } as never;
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as { status: jest.Mock; json: jest.Mock };
    const next = jest.fn();

    middleware(req as never, res as never, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
