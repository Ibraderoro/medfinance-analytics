import { Request, Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate, authorize } from '../middleware/auth';
import { attachTenantContext, blockTenantOverride } from '../middleware/tenantContext';
import { validateRequest } from '../middleware/validateRequest';
import { askAi, askAiValidators, getSummary } from '../controllers/ai.controller';
import { env } from '../config/env';

export const aiRouter = Router();

// Dedicated rate limiter: stricter window (1 min) per user ID
const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: env.AI_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const authReq = req as Request & { user?: { id: string } };
    return authReq.user?.id ?? req.ip ?? 'unknown';
  },
  message: {
    success: false,
    error: {
      message: 'Too many AI requests. Please wait before sending another message.',
      code: 'AI_RATE_LIMITED',
    },
  },
});

aiRouter.use(authenticate);
aiRouter.use(attachTenantContext);
aiRouter.use(blockTenantOverride);
aiRouter.use(aiRateLimiter);

aiRouter.post('/ask', authorize('viewer'), askAiValidators, validateRequest(), askAi);
aiRouter.get('/summary', authorize('viewer'), getSummary);
