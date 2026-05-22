import { Request, Router } from 'express';
import { authSchemas } from '@medfinance/shared';
import { authRateLimiter } from '../middleware/rateLimiter';
import { validateBody } from '../middleware/zodValidate';
import { login, register, refresh, logout, verifyMfa, initiateOidc, completeOidc } from '../controllers/auth.controller';

export const authRouter = Router();

function hasCookie(req: Request, name: string): boolean {
  return Boolean(req.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .some((part) => part.startsWith(`${name}=`)));
}

authRouter.post(
  '/register',
  authRateLimiter,
  validateBody(authSchemas.registerBody),
  register,
);

authRouter.post(
  '/login',
  authRateLimiter,
  validateBody(authSchemas.loginBody),
  login,
);

authRouter.post(
  '/refresh',
  authRateLimiter,
  validateBody(authSchemas.refreshBody),
  (req, res, next) => {
    const refreshToken = (req.body as { refreshToken?: string } | undefined)?.refreshToken;
    if ((refreshToken === undefined || refreshToken === null || refreshToken === '') && !hasCookie(req as Request, 'medfinance_refresh_token')) {
      res.status(400).json({
        success: false,
        error: { message: 'Validation Failed', details: [{ field: 'refreshToken', message: 'refreshToken is required', code: 'custom' }], code: 'VALIDATION_ERROR' },
      });
      return;
    }
    next();
  },
  refresh,
);

authRouter.post('/logout', logout);

authRouter.post('/mfa/verify', authRateLimiter, validateBody(authSchemas.verifyMfaBody), verifyMfa);
authRouter.post('/oidc/initiate', authRateLimiter, validateBody(authSchemas.oidcInitiateBody), initiateOidc);
authRouter.post('/oidc/callback', authRateLimiter, validateBody(authSchemas.oidcCallbackBody), completeOidc);
