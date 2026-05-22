import { z } from 'zod';

const UUID_LIKE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const authSchemas = {
  registerBody: z.object({ email: z.string().email(), password: z.string().min(8), firstName: z.string().min(1), lastName: z.string().min(1), organizationId: z.string().regex(UUID_LIKE_PATTERN, 'Valid organization ID (UUID-like) is required'), role: z.literal('viewer').optional() }),
  loginBody: z.object({ email: z.string().email(), password: z.string().min(1), organizationId: z.string().regex(UUID_LIKE_PATTERN, 'Valid organization ID (UUID-like) is required') }),
  refreshBody: z.object({ refreshToken: z.string().min(1).optional() }),
  verifyMfaBody: z.object({ tempToken: z.string().min(1), code: z.string().length(6) }),
  oidcInitiateBody: z.object({ email: z.string().email(), organizationId: z.string().regex(UUID_LIKE_PATTERN, 'Valid organization ID (UUID-like) is required') }),
  oidcCallbackBody: z.object({ state: z.string().uuid('Valid SSO state is required'), code: z.string().min(1, 'Authorization code is required') }),
};

export const financialSchemas = {
  summaryQuery: z.object({ period: z.string().default('monthly'), year: z.coerce.number().int().min(2000).max(2100).default(new Date().getFullYear()) }),
  dateRangeQuery: z.object({ startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).refine((data: { startDate?: string; endDate?: string }) => !(data.startDate && data.endDate) || data.startDate <= data.endDate, { message: 'endDate must be greater than or equal to startDate', path: ['endDate'] }),
};
