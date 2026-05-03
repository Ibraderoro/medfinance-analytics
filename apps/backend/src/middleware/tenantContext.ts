import { NextFunction, Response } from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import { AuthenticatedRequest } from './auth';

declare module 'express-serve-static-core' {
  interface Request {
    tenant?: {
      userId: string;
      organizationId: string;
    };
  }
}

const TENANT_ORG_FIELDS = ['organization_id', 'organizationId', 'organisationId'] as const;
const BLOCKED_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const tenantStorage = new AsyncLocalStorage<{ organizationId: string; userId: string }>();

export function getCurrentTenantContext(): { organizationId: string; userId: string } | undefined {
  return tenantStorage.getStore();
}

function stripTenantFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripTenantFields(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (
      TENANT_ORG_FIELDS.includes(key as typeof TENANT_ORG_FIELDS[number])
      || BLOCKED_OBJECT_KEYS.has(key)
    ) {
      continue;
    }
    output[key] = stripTenantFields(nested);
  }

  return output;
}

/**
 * Attaches authenticated tenant context to request scope and async-local storage.
 */
export function attachTenantContext(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  const organizationId = req.user?.organization_id;
  const userId = req.user?.id;
  if (!organizationId || !userId) {
    res.status(403).json({
      success: false,
      error: { message: 'organization_id is required for tenant-scoped access', code: 'TENANT_REQUIRED' },
    });
    return;
  }

  req.tenant = { userId, organizationId };
  tenantStorage.run({ userId, organizationId }, () => next());
}

/**
 * Removes tenant-overridable payload fields from request bodies.
 */
export function blockTenantOverride(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user?.organization_id) {
    res.status(403).json({
      success: false,
      error: { message: 'organization_id is required for tenant-scoped access', code: 'TENANT_REQUIRED' },
    });
    return;
  }

  if (req.body && typeof req.body === 'object') {
    req.body = stripTenantFields(req.body) as AuthenticatedRequest['body'];
  }

  next();
}
