import { Request, Router } from 'express';
import { body } from 'express-validator';
import { authRateLimiter } from '../middleware/rateLimiter';
import { bruteForceProtection } from '../middleware/bruteForceProtection';
import { validateRequest } from '../middleware/validateRequest';
import { login, register, refresh, logout, verifyMfa, initiateOidc, completeOidc } from '../controllers/auth.controller';

export const authRouter = Router();
const UUID_LIKE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getCookieValue(req: Request, name: string): string | undefined {
  const pair = req.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!pair) return undefined;
  return pair.slice(name.length + 1);
}

authRouter.post(
  '/register',
  authRateLimiter,
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('firstName').notEmpty().withMessage('First name is required'),
    body('lastName').notEmpty().withMessage('Last name is required'),
    body('organizationId')
      .matches(UUID_LIKE_PATTERN)
      .withMessage('Valid organization ID (UUID-like) is required'),
    body('role')
      .optional()
      .equals('viewer')
      .withMessage('Public registration can only create viewer accounts'),
  ],
  validateRequest(),
  bruteForceProtection,
  register,
);

authRouter.post(
  '/login',
  authRateLimiter,
  bruteForceProtection,
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required'),
    body('organizationId')
      .matches(UUID_LIKE_PATTERN)
      .withMessage('Valid organization ID (UUID-like) is required'),
  ],
  validateRequest(),
  login,
);

authRouter.post(
  '/refresh',
  authRateLimiter,
  [
    body('refreshToken')
      .custom((value, { req }) => {
        if (value === undefined || value === null || value === '') {
          const cookieValue = getCookieValue(req as Request, 'medfinance_refresh_token');
          return typeof cookieValue === 'string' && cookieValue.trim().length > 0;
        }

        if (typeof value === 'string' && value.trim().length > 0) return true;
        throw new Error('refreshToken must be a non-empty string');
      })
      .withMessage('refreshToken is required'),
  ],
  validateRequest(),
  refresh,
);

authRouter.post('/logout', logout);

authRouter.post('/mfa/verify', authRateLimiter, [body('tempToken').notEmpty(), body('code').isLength({ min: 6, max: 6 })], validateRequest(), verifyMfa);
authRouter.post('/oidc/initiate', authRateLimiter, [body('email').isEmail().normalizeEmail(), body('organizationId').matches(UUID_LIKE_PATTERN).withMessage('Valid organization ID (UUID-like) is required')], validateRequest(), initiateOidc);
authRouter.post('/oidc/callback', authRateLimiter, [body('state').isUUID().withMessage('Valid SSO state is required'), body('code').isString().trim().notEmpty().withMessage('Authorization code is required')], validateRequest(), completeOidc);
