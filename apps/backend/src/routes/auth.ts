import { Request, Router } from 'express';
import { body } from 'express-validator';
import { authRateLimiter } from '../middleware/rateLimiter';
import { validateRequest } from '../middleware/validateRequest';
import { login, register, refresh, logout, verifyMfa, initiateOidc } from '../controllers/auth.controller';

export const authRouter = Router();
const UUID_LIKE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hasCookie(req: Request, name: string): boolean {
  return Boolean(req.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .some((part) => part.startsWith(`${name}=`)));
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
  register,
);

authRouter.post(
  '/login',
  authRateLimiter,
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
        if (typeof value === 'string' && value.trim().length > 0) return true;
        if (hasCookie(req as Request, 'medfinance_refresh_token')) return true;
        if (value === undefined || value === null || value === '') return false;
        throw new Error('refreshToken must be a non-empty string');
      })
      .withMessage('refreshToken is required'),
  ],
  validateRequest(),
  refresh,
);

authRouter.post('/logout', logout);

authRouter.post('/mfa/verify', authRateLimiter, [body('tempToken').notEmpty(), body('code').isLength({ min: 6, max: 6 })], validateRequest(), verifyMfa);
authRouter.post('/oidc/initiate', authRateLimiter, [body('email').isEmail().normalizeEmail()], validateRequest(), initiateOidc);
