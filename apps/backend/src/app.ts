import express, { Application } from 'express';
import helmet from 'helmet';
import cors, { CorsOptions } from 'cors';
import compression from 'compression';
import { env } from './config/env';
import { router } from './routes';
import { handleStripeWebhook } from './controllers/billing.controller';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { rateLimiter } from './middleware/rateLimiter';
import { requestLogger } from './middleware/logger';
import { sanitizeInput } from './middleware/sanitizeInput';
import { trackApiAnalytics } from './middleware/analytics';
import { requestContext } from './middleware/requestContext';
import { responseEnvelope } from './middleware/responseEnvelope';

export const app: Application = express();
app.locals.isShuttingDown = false;

if (env.isProduction()) {
  app.set('trust proxy', 1);
}

const allowedOrigins: string[] = env.CORS_ALLOWED_ORIGINS;

const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) {
      // Requests with no Origin header are server-to-server or CLI tools (e.g. curl).
      // credentials:true only applies to browser requests, so this is intentional.
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

app.disable('x-powered-by');
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-site' },
  contentSecurityPolicy: env.isProduction(),
  hsts: env.isProduction(),
}));
app.use(cors(corsOptions));
app.use(compression());
app.use(rateLimiter);
app.use(requestContext);

app.post('/api/v1/billing/webhook', express.raw({ type: 'application/json' }), handleStripeWebhook);

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(sanitizeInput);
app.use(responseEnvelope);

app.use(requestLogger);
app.use(trackApiAnalytics);

app.use('/api/v1', router);
app.use(notFoundHandler);
app.use(errorHandler);
