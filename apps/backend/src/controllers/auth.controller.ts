import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';
import { env } from '../config/env';

const service = new AuthService();
const ACCESS_COOKIE = 'medfinance_access_token';
const REFRESH_COOKIE = 'medfinance_refresh_token';

function setAuthCookies(res: Response, accessToken?: string, refreshToken?: string): void {
  if (!accessToken || !refreshToken) throw new Error('Missing auth tokens from auth service');
  const secure = env.isProduction();
  res.cookie(ACCESS_COOKIE, accessToken, { httpOnly: true, secure, sameSite: 'strict', path: '/', maxAge: 24 * 60 * 60 * 1000 });
  res.cookie(REFRESH_COOKIE, refreshToken, { httpOnly: true, secure, sameSite: 'strict', path: '/api/v1/auth', maxAge: 7 * 24 * 60 * 60 * 1000 });
}

function clearAuthCookies(res: Response): void {
  const secure = env.isProduction();
  res.clearCookie(ACCESS_COOKIE, { httpOnly: true, secure, sameSite: 'strict', path: '/' });
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure, sameSite: 'strict', path: '/api/v1/auth' });
}

function parseCookies(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  return Object.fromEntries(raw.split(';').map((part) => {
    const [k, ...rest] = part.trim().split('=');
    return [k, decodeURIComponent(rest.join('='))];
  }).filter(([k]) => Boolean(k)));
}

export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!env.ALLOW_SELF_SERVICE_REGISTRATION) {
      res.status(403).json({ success: false, error: { message: 'Self-service registration is disabled', code: 'AUTH_REGISTRATION_DISABLED' }, data: null });
      return;
    }
    const { email, password, firstName, lastName, role, organizationId } = req.body as { email: string; password: string; firstName: string; lastName: string; role?: string; organizationId: string };
    const tokens = await service.register(email, password, firstName, lastName, organizationId, role);
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    res.success({ session: 'created' }, 201);
  } catch (err) { next(err); }
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password, organizationId } = req.body as { email: string; password: string; organizationId: string };
    const result = await service.login(email, password, organizationId);
    if (result.status === 'mfa_required') {
      clearAuthCookies(res);
      if (typeof result.tempToken !== 'string' || result.tempToken.length === 0) {
        res.status(500).json({ success: false, error: { message: 'MFA token generation failed', code: 'AUTH_MFA_TOKEN_MISSING' }, data: null });
        return;
      }
      res.success({ session: 'pending_mfa', tempToken: result.tempToken });
      return;
    }
    setAuthCookies(res, result.accessToken, result.refreshToken);
    res.success({ session: 'created' });
  } catch (err) { next(err); }
}

export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const bodyRefresh = (req.body as { refreshToken?: string }).refreshToken;
    const cookieRefresh = parseCookies(req.headers.cookie)[REFRESH_COOKIE];
    const refreshToken = bodyRefresh ?? cookieRefresh;
    if (typeof refreshToken !== 'string' || refreshToken.trim().length === 0) {
      res.status(400).json({ success: false, error: { message: 'refreshToken is required', code: 'AUTH_REFRESH_TOKEN_REQUIRED' }, data: null });
      return;
    }
    const tokens = await service.refresh(refreshToken);
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    res.success({ session: 'refreshed' });
  } catch (err) { next(err); }
}

export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const bodyRefresh = (req.body as { refreshToken?: string }).refreshToken;
    const cookieRefresh = parseCookies(req.headers.cookie)[REFRESH_COOKIE];
    const refreshToken = bodyRefresh ?? cookieRefresh;
    if (refreshToken) await service.logout(refreshToken);
    clearAuthCookies(res);
    res.success({ loggedOut: true });
  } catch (err) { next(err); }
}

export async function verifyMfa(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { tempToken, code } = req.body as { tempToken: string; code: string };
    const tokens = await service.verifyMfa(tempToken, code);
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    res.success({ session: 'created' });
  } catch (err) { next(err); }
}

export async function initiateOidc(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, organizationId } = req.body as { email: string; organizationId: string };
    if (!organizationId || typeof organizationId !== 'string') {
      res.status(400).json({ success: false, error: { message: 'organizationId is required', code: 'AUTH_ORG_REQUIRED' }, data: null });
      return;
    }
    const data = await service.initiateSsoLogin('oidc', email, organizationId);
    res.success(data);
  } catch (err) { next(err); }
}
