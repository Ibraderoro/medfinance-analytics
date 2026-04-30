import 'dotenv/config';
import { app } from './app';
import { logger } from './utils/logger';
import { connectDatabase, disconnectDatabase } from './config/database';
import { migrate } from './db/migrate';
import { validateRequiredTables } from './db/schemaValidation';
import { connectRedis, disconnectRedis } from './config/redis';
import { env } from './config/env';
import { liveFinancialsService } from './services/liveFinancials.service';
import { startTracing, stopTracing } from './observability/tracing';

const PORT = Number.parseInt(process.env.PORT ?? `${env.PORT}`, 10);
let isShuttingDown = false;

app.use((_req, res, next) => {
  if (isShuttingDown) {
    res.setHeader('Connection', 'close');
    res.status(503).json({
      success: false,
      error: { message: 'Server is shutting down', code: 'SERVER_SHUTTING_DOWN' },
    });
    return;
  }
  next();
});

async function bootstrap(): Promise<void> {
  try {
    await startTracing();
    await connectDatabase();
    await migrate();
    await validateRequiredTables();
    await connectRedis();

    await liveFinancialsService.start();

    const server = app.listen(PORT, () => {
      logger.info('MedFinance API started', { port: PORT, env: env.NODE_ENV });
    });
    server.requestTimeout = env.HTTP_REQUEST_TIMEOUT_MS;
    server.headersTimeout = env.HTTP_HEADERS_TIMEOUT_MS;
    server.keepAliveTimeout = env.HTTP_KEEP_ALIVE_TIMEOUT_MS;

    const shutdown = async (signal: string) => {
      if (isShuttingDown) {
        return;
      }
      isShuttingDown = true;
      app.locals.isShuttingDown = true;

      logger.info('Received shutdown signal', { signal });
      await liveFinancialsService.stop();
      server.close(async (error) => {
        if (error) {
          logger.error('Error during server shutdown', { message: error.message, stack: error.stack });
          process.exit(1);
          return;
        }

        await Promise.allSettled([disconnectDatabase(), disconnectRedis(), stopTracing()]);
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => {
      void shutdown('SIGTERM');
    });
    process.on('SIGINT', () => {
      void shutdown('SIGINT');
    });
  } catch (error) {
    const err = error as Error;
    logger.error('Failed to start server', { message: err.message, stack: err.stack });
    process.exit(1);
  }
}

process.on('unhandledRejection', (reason) => {
  const err = reason as Error;
  logger.error('Unhandled promise rejection', { message: err?.message ?? String(reason), stack: err?.stack });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { message: error.message, stack: error.stack });
  process.exit(1);
});

void bootstrap();
