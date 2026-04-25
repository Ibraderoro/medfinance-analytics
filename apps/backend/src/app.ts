import express, { Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import { env } from './config/env';
import { router } from './routes';
import { errorHandler } from './middleware/errorHandler';
import { rateLimiter } from './middleware/rateLimiter';
import { requestLogger } from './middleware/logger';

export const app: Application = express();
app.set('trust proxy', 1);

// ── Security ──────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }

    const isAllowedOrigin = env.CORS_ALLOWED_ORIGINS.includes(origin);
    callback(isAllowedOrigin ? null : new Error('Origin not allowed by CORS'), isAllowedOrigin);
  },
  credentials: true,
}));
app.use(rateLimiter);

// ── Body parsing & compression ────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(compression());

// ── Logging ───────────────────────────────────────────────────────────────
app.use(morgan('combined'));
app.use(requestLogger);

// ── Routes ────────────────────────────────────────────────────────────────
app.use('/api/v1', router);

// ── Error handling ────────────────────────────────────────────────────────
app.use(errorHandler);
