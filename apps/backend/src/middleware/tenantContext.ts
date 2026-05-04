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

/**
 * Retrieve the tenant context associated with the current asynchronous execution.
 *
 * @returns The tenant context object containing `organizationId` and `userId`, or `undefined` if no tenant context is set for the current async call chain.
 */
export function getCurrentTenantContext(): { organizationId: string; userId: string } | undefined {
  return tenantStorage.getStore();
}

/**
 * Recursively removes tenant organization identifier properties and unsafe object keys from the provided value.
 *
 * @param value - The value to sanitize; may be an object, array, or primitive.
 * @returns The sanitized structure with organization ID properties (`organization_id`, `organizationId`, `organisationId`) and blocked keys (`__proto__`, `constructor`, `prototype`) removed; arrays and primitive values are returned with their elements/values preserved. 
 */
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
 * Attaches tenant identifiers from the authenticated user to the request and establishes the async-local tenant context for the remainder of the request.
 *
 * If `req.user?.organization_id` or `req.user?.id` is missing, responds with HTTP 403 and JSON:
 * `{ success: false, error: { message: 'organization_id is required for tenant-scoped access', code: 'TENANT_REQUIRED' } }`.
 *
 * When both identifiers are present, sets `req.tenant = { userId, organizationId }` and executes the remainder of the request inside the tenant async-local storage scope so downstream code can access the tenant context.
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
 * Prevents clients from overriding tenant-scoped organization fields and enforces tenant presence.
 *
 * If `req.user.organization_id` is missing, sends a 403 JSON error with code `TENANT_REQUIRED` and does not call `next()`.
 * If `req.body` is an object, removes any tenant organization identifier fields (e.g., `organization_id`, `organizationId`, `organisationId`) before continuing.
 *
 * @param req - Incoming authenticated request; may be mutated (its `body` is sanitized and `tenant` is expected to be present on `req.user`)
 * @param res - Express response used to send the 403 error when the tenant is missing
 * @param next - Next middleware function to call when validation and sanitization complete
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
