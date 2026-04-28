import express, { Application } from 'express';
import helmet from 'helmet';
import cors, { CorsOptions } from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import { env } from './config/env';
import { router } from './routes';
import { handleStripeWebhook } from './controllers/billing.controller';
import { errorHandler } from './middleware/errorHandler';
import { rateLimiter } from './middleware/rateLimiter';
import { requestLogger } from './middleware/logger';
import { sanitizeInput } from './middleware/sanitizeInput';
import { trackApiAnalytics } from './middleware/analytics';

export const app: Application = express();
app.locals.isShuttingDown = false;

// ── Runtime/infra settings ───────────────────────────────────────────────
if (env.isProduction()) {
  app.set('trust proxy', 1);
}

const allowedOrigins: string[] = env.CORS_ALLOWED_ORIGINS;

const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    // Allow server-to-server and same-origin calls without an Origin header.
    if (!origin) {
      callback(null, true);
      return;
    }

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('Origin not allowed by CORS'));
  },
  credentials: true,
};

// ── Security ──────────────────────────────────────────────────────────────
app.disable('x-powered-by');
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-site' },
  contentSecurityPolicy: env.isProduction(),
  hsts: env.isProduction(),
}));
app.use(cors(corsOptions));
app.use(rateLimiter);

// Stripe webhook must receive the raw payload for signature verification.
app.post('/api/v1/billing/webhook', express.raw({ type: 'application/json' }), handleStripeWebhook);

// ── Body parsing & compression ────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(sanitizeInput);
app.use(compression());

// ── Logging ───────────────────────────────────────────────────────────────
app.use(morgan('combined'));
app.use(requestLogger);
app.use(trackApiAnalytics);

// ── Routes ────────────────────────────────────────────────────────────────
app.use('/api/v1', router);

// ── Error handling ────────────────────────────────────────────────────────
app.use(errorHandler);
