import type { NextFunction, Response } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth';

const mockGetOrganizationSubscription = jest.fn();
const mockRequireAuthenticatedUser = jest.fn();

jest.mock('../services/billing.service', () => ({
  BillingService: jest.fn().mockImplementation(() => ({
    getOrganizationSubscription: mockGetOrganizationSubscription,
  })),
}));

jest.mock('../middleware/auth', () => ({
  requireAuthenticatedUser: (...args: unknown[]) => mockRequireAuthenticatedUser(...args),
}));

import { enforceFreeHistoryWindow, requireMinimumPlan } from '../middleware/planAccess';

function createResponse(): Response {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };

  return res as unknown as Response;
}

describe('planAccess middleware', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-06-15T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('requireMinimumPlan', () => {
    it('calls next when subscription meets minimum plan and is active', async () => {
      const req = {} as AuthenticatedRequest;
      const res = createResponse();
      const next = jest.fn() as NextFunction;

      mockRequireAuthenticatedUser.mockReturnValue({ organization_id: 'org-1' });
      mockGetOrganizationSubscription.mockResolvedValue({ plan: 'pro', status: 'active' });

      await requireMinimumPlan('pro')(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('returns 403 when plan is below required plan', async () => {
      const req = {} as AuthenticatedRequest;
      const res = createResponse();
      const next = jest.fn() as NextFunction;

      mockRequireAuthenticatedUser.mockReturnValue({ organization_id: 'org-1' });
      mockGetOrganizationSubscription.mockResolvedValue({ plan: 'free', status: 'active' });

      await requireMinimumPlan('pro')(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'PLAN_REQUIRED' }),
      }));
      expect(next).not.toHaveBeenCalled();
    });

    it('forwards errors to next', async () => {
      const req = {} as AuthenticatedRequest;
      const res = createResponse();
      const next = jest.fn() as NextFunction;
      const error = new Error('auth missing');

      mockRequireAuthenticatedUser.mockImplementation(() => {
        throw error;
      });

      await requireMinimumPlan('pro')(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('enforceFreeHistoryWindow', () => {
    it('calls next for non-free plans', async () => {
      const req = { query: {} } as unknown as AuthenticatedRequest;
      const res = createResponse();
      const next = jest.fn() as NextFunction;

      mockRequireAuthenticatedUser.mockReturnValue({ organization_id: 'org-1' });
      mockGetOrganizationSubscription.mockResolvedValue({ plan: 'pro', status: 'active' });

      await enforceFreeHistoryWindow(3)(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('returns 403 for free plan when startDate is missing', async () => {
      const req = { query: {} } as unknown as AuthenticatedRequest;
      const res = createResponse();
      const next = jest.fn() as NextFunction;

      mockRequireAuthenticatedUser.mockReturnValue({ organization_id: 'org-1' });
      mockGetOrganizationSubscription.mockResolvedValue({ plan: 'free', status: 'active' });

      await enforceFreeHistoryWindow(3)(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'PLAN_HISTORY_WINDOW_EXCEEDED' }),
      }));
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 403 for free plan when startDate is outside allowed window', async () => {
      const req = { query: { startDate: '2026-01-01' } } as unknown as AuthenticatedRequest;
      const res = createResponse();
      const next = jest.fn() as NextFunction;

      mockRequireAuthenticatedUser.mockReturnValue({ organization_id: 'org-1' });
      mockGetOrganizationSubscription.mockResolvedValue({ plan: 'free', status: 'active' });

      await enforceFreeHistoryWindow(3)(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('calls next for free plan when startDate is within allowed window', async () => {
      const req = { query: { startDate: '2026-05-01' } } as unknown as AuthenticatedRequest;
      const res = createResponse();
      const next = jest.fn() as NextFunction;

      mockRequireAuthenticatedUser.mockReturnValue({ organization_id: 'org-1' });
      mockGetOrganizationSubscription.mockResolvedValue({ plan: 'free', status: 'active' });

      await enforceFreeHistoryWindow(3)(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('forwards downstream errors to next', async () => {
      const req = { query: {} } as unknown as AuthenticatedRequest;
      const res = createResponse();
      const next = jest.fn() as NextFunction;
      const error = new Error('subscription lookup failed');

      mockRequireAuthenticatedUser.mockReturnValue({ organization_id: 'org-1' });
      mockGetOrganizationSubscription.mockRejectedValue(error);

      await enforceFreeHistoryWindow(3)(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });
});
