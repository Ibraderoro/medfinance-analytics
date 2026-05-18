import type { Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth';
import {
  attachTenantContext,
  blockTenantOverride,
  getCurrentTenantContext,
  runWithTenantContext,
} from '../middleware/tenantContext';

function makeResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
}

describe('tenant context middleware', () => {
  it('runs operations with retrievable async tenant context', async () => {
    await expect(runWithTenantContext({ organizationId: 'org-1', userId: 'user-1' }, async () => getCurrentTenantContext())).resolves.toEqual({
      organizationId: 'org-1',
      userId: 'user-1',
    });
  });

  it('attaches authenticated tenant context and calls next inside the async scope', () => {
    const req = {
      user: { id: 'user-1', email: 'u@example.com', role: 'viewer', organization_id: 'org-1' },
    } as AuthenticatedRequest;
    const res = makeResponse();
    const next = jest.fn(() => {
      expect(getCurrentTenantContext()).toEqual({ organizationId: 'org-1', userId: 'user-1' });
    }) as NextFunction;

    attachTenantContext(req, res, next);

    expect(req.tenant).toEqual({ organizationId: 'org-1', userId: 'user-1' });
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects tenant context attachment when user or organization identifiers are missing', () => {
    const res = makeResponse();
    const next = jest.fn() as NextFunction;

    attachTenantContext({ user: undefined } as AuthenticatedRequest, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();

    const resWithoutOrg = makeResponse();
    attachTenantContext({ user: { id: 'user-1', email: 'u@example.com', role: 'viewer', organization_id: '' } } as AuthenticatedRequest, resWithoutOrg, next);
    expect(resWithoutOrg.status).toHaveBeenCalledWith(403);
  });

  it('removes nested tenant override and prototype-pollution fields from request bodies', () => {
    const req = {
      user: { id: 'user-1', email: 'u@example.com', role: 'viewer', organization_id: 'org-1' },
      body: {
        organization_id: 'evil-org',
        keep: 'value',
        nested: {
          organizationId: 'evil-org',
          keepNested: true,
          constructor: { polluted: true },
        },
        list: [
          { organisationId: 'evil-org', amount: 10 },
          'literal',
        ],
        prototype: 'polluted',
      },
    } as unknown as AuthenticatedRequest;
    const res = makeResponse();
    const next = jest.fn() as NextFunction;

    blockTenantOverride(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.body).toEqual({
      keep: 'value',
      nested: { keepNested: true },
      list: [{ amount: 10 }, 'literal'],
    });
  });

  it('allows primitive or absent bodies through and rejects missing tenants', () => {
    const res = makeResponse();
    const next = jest.fn() as NextFunction;

    blockTenantOverride({ user: { id: 'user-1', email: 'u@example.com', role: 'viewer', organization_id: 'org-1' }, body: undefined } as AuthenticatedRequest, res, next);
    expect(next).toHaveBeenCalledTimes(1);

    const forbiddenRes = makeResponse();
    blockTenantOverride({ user: { id: 'user-1', email: 'u@example.com', role: 'viewer', organization_id: '' } } as AuthenticatedRequest, forbiddenRes, next);
    expect(forbiddenRes.status).toHaveBeenCalledWith(403);
  });
});
