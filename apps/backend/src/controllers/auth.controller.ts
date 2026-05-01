import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';
import { env } from '../config/env';

const service = new AuthService();
const ACCESS_COOKIE = 'medfinance_access_token';
const REFRESH_COOKIE = 'medfinance_refresh_token';

/**
 * Set HTTP-only authentication cookies for an access token and a refresh token on the provided response.
 *
 * @param res - Express response used to set cookies
 * @param accessToken - JWT access token stored in an httpOnly cookie at path `/` with a 24-hour maxAge
 * @param refreshToken - JWT refresh token stored in an httpOnly cookie at path `/api/v1/auth` with a 7-day maxAge
 * @throws Error if either `accessToken` or `refreshToken` is missing
 */
function setAuthCookies(res: Response, accessToken?: string, refreshToken?: string): void {
  if (!accessToken || !refreshToken) throw new Error('Missing auth tokens from auth service');
  const secure = env.isProduction();
  res.cookie(ACCESS_COOKIE, accessToken, { httpOnly: true, secure, sameSite: 'strict', path: '/', maxAge: 24 * 60 * 60 * 1000 });
  res.cookie(REFRESH_COOKIE, refreshToken, { httpOnly: true, secure, sameSite: 'strict', path: '/api/v1/auth', maxAge: 7 * 24 * 60 * 60 * 1000 });
}

/**
 * Removes authentication cookies from the response.
 *
 * Clears the access and refresh token cookies used for authentication. The cookies are removed with `httpOnly` and `sameSite: 'strict'`; the `secure` flag is enabled when running in production and each cookie is cleared at its respective path.
 */
function clearAuthCookies(res: Response): void {
  const secure = env.isProduction();
  res.clearCookie(ACCESS_COOKIE, { httpOnly: true, secure, sameSite: 'strict', path: '/' });
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure, sameSite: 'strict', path: '/api/v1/auth' });
}

/**
 * Parse a Cookie header string into a map of cookie names to values.
 *
 * @param raw - Raw `Cookie` header (e.g., `"a=1; b=2"`). If omitted or empty, an empty object is returned.
 * @returns A record mapping each cookie name to its decoded value.
 */
function parseCookies(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  return Object.fromEntries(raw.split(';').map((part) => {
    const [k, ...rest] = part.trim().split('=');
    return [k, decodeURIComponent(rest.join('='))];
  }).filter(([k]) => Boolean(k)));
}

/**
 * Handle user registration, create an authenticated session, set auth cookies, and respond with session status.
 *
 * If self-service registration is disabled, responds with 403 and an error payload (code `AUTH_REGISTRATION_DISABLED`).
 * On success, creates the user session via the AuthService, sets HTTP-only access and refresh cookies, and returns a 201 response with `{ session: 'created' }`.
 *
 * Errors are forwarded to Express error handling via `next`.
 */
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

/**
 * Authenticate a user, set HTTP-only authentication cookies, and signal a created session.
 *
 * Reads credentials from the request body, obtains access and refresh tokens from the auth service,
 * stores them in secure cookies, and sends a session-created response.
 */
export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password, organizationId } = req.body as { email: string; password: string; organizationId: string };
    const tokens = await service.login(email, password, organizationId);
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    res.success({ session: 'created' });
  } catch (err) { next(err); }
}

/**
 * Refreshes authentication tokens using a provided refresh token.
 *
 * Validates a refresh token from the request body (`refreshToken`) or the refresh cookie, exchanges it for new tokens, sets updated auth cookies, and responds with `{ session: 'refreshed' }`. If the refresh token is missing or empty, responds with HTTP 400 and an error payload.
 *
 * @param req - Express request; the function reads `refreshToken` from `req.body.refreshToken` or from the `medfinance_refresh_token` cookie in `req.headers.cookie`
 */
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

/**
 * Logs the current session out by invalidating the provided refresh token (if present) and clearing authentication cookies.
 *
 * If `req.body.refreshToken` is absent, the handler will attempt to read the refresh token from the refresh cookie. When a refresh token is available it will be invalidated via the auth service. Authentication cookies are cleared and a JSON success payload `{ loggedOut: true }` is sent.
 *
 * @param req - Express request; may include `refreshToken` in the body or rely on the refresh cookie.
 * @param res - Express response; authentication cookies will be cleared and a success payload returned.
 * @param next - Express next function for error propagation.
 */
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
