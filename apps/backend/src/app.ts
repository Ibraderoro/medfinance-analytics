import crypto from 'crypto';
import express, { Application, NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import cors, { CorsOptions } from 'cors';
import compression from 'compression';
import { env } from './config/env';
import { router } from './routes';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { rateLimiter } from './middleware/rateLimiter';
import { requestLogger } from './middleware/logger';
import { sanitizeInput } from './middleware/sanitizeInput';
import { trackApiAnalytics } from './middleware/analytics';
import { requestContext } from './middleware/requestContext';
import { responseEnvelope } from './middleware/responseEnvelope';
import { observabilityMiddleware } from './middleware/observability';

export const app: Application = express();
app.locals.isShuttingDown = false;

if (env.isProduction()) app.set('trust proxy', 1);

const allowedOrigins: string[] = env.CORS_ALLOWED_ORIGINS;
const csrfHeaderName = 'x-csrf-token';
const csrfCookieName = 'csrf_token';

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/$/, '').toLowerCase();
}

function parseCookies(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  return Object.fromEntries(raw.split(';').map((part) => {
    const [k, ...rest] = part.trim().split('=');
    return [k, decodeURIComponent(rest.join('='))];
  }).filter(([k]) => Boolean(k)));
}

const normalizedAllowedOrigins = allowedOrigins.map(normalizeOrigin);
const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    return callback(normalizedAllowedOrigins.includes(normalizeOrigin(origin)) ? null : new Error('Origin not allowed by CORS'), true);
  },
  credentials: true,
};

const csrfProtection = (req: Request, res: Response, next: NextFunction): void => {
  const cookies = parseCookies(req.headers.cookie);
  let csrfToken = cookies[csrfCookieName];
  if (!csrfToken) {
    csrfToken = crypto.randomBytes(32).toString('hex');
    res.cookie(csrfCookieName, csrfToken, {
      httpOnly: false,
      secure: env.isProduction(),
      sameSite: 'strict',
      path: '/',
    });
  }

  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const headerToken = req.header(csrfHeaderName);
  if (!headerToken || headerToken !== csrfToken) {
    res.status(403).json({ success: false, error: { message: 'CSRF token validation failed', code: 'SECURITY_CSRF' }, data: null });
    return;
  }

  next();
};

app.disable('x-powered-by');
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-site' },
  hsts: env.isProduction(),
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"].concat(normalizedAllowedOrigins),
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: env.isProduction() ? [] : null,
    },
  },
}));
app.use(cors(corsOptions));
app.use(compression({ filter: (req, res) => (res.getHeader('Content-Type') === 'text/event-stream' ? false : compression.filter(req, res)) }));
app.use(rateLimiter);
app.use(requestContext);
app.use('/api/v1/billing/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(sanitizeInput);
app.use(csrfProtection);
app.use(responseEnvelope);
app.use(observabilityMiddleware);
app.use(requestLogger);
app.use(trackApiAnalytics);
app.use('/api/v1', router);
app.use(notFoundHandler);
app.use(errorHandler);
