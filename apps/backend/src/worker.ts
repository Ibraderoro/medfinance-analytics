import 'dotenv/config';
import { logger } from './utils/logger';
import { connectDatabase, disconnectDatabase } from './config/database';
import { assertCompatibleSchemaVersion } from './db/schemaCompatibility';
import { validateRequiredTables } from './db/schemaValidation';
import { connectRedis, disconnectRedis } from './config/redis';
import { connectQueueRedis, disconnectQueueRedis } from './config/queueRedis';
import { env } from './config/env';
import { startTracing, stopTracing } from './observability/tracing';
import { registerWorkers, closeWorkers } from './queue/workers';
import { scheduleRepeatableJobs } from './queue/scheduler';
import { closeAllQueues } from './queue/queues';
import { startMetricsPoller, stopMetricsPoller } from './queue/metricsPoller';
import { startWorkerHealthServer } from './worker/healthServer';

let isShuttingDown = false;

/**
 * Bootstraps the standalone worker process: tracing, database/Redis
 * connections, schema checks, BullMQ workers + repeatable job scheduling, the
 * metrics poller, and a small health-check HTTP server — mirrors `index.ts`'s
 * non-HTTP bootstrap sequence so the two entrypoints don't drift.
 */
async function bootstrap(): Promise<void> {
  try {
    await startTracing();
    await connectDatabase();
    await assertCompatibleSchemaVersion();
    await validateRequiredTables();
    await connectRedis();
    await connectQueueRedis();

    await registerWorkers();
    await scheduleRepeatableJobs();
    startMetricsPoller();

    const healthServer = startWorkerHealthServer(() => isShuttingDown);

    logger.info('MedFinance worker started', { env: env.NODE_ENV, healthPort: env.WORKER_HEALTH_PORT });

    const shutdown = async (signal: string) => {
      if (isShuttingDown) {
        return;
      }
      isShuttingDown = true;

      logger.info('Worker received shutdown signal', { signal });

      const watchdog = setTimeout(() => {
        logger.error('Worker shutdown timed out, forcing exit', {
          signal,
          timeoutMs: env.WORKER_SHUTDOWN_TIMEOUT_MS,
        });
        process.exit(0);
      }, env.WORKER_SHUTDOWN_TIMEOUT_MS);
      watchdog.unref();

      try {
        stopMetricsPoller();
        await closeWorkers();
        await closeAllQueues();

        await new Promise<void>((resolve) => healthServer.close(() => resolve()));
        await Promise.allSettled([disconnectDatabase(), disconnectRedis(), disconnectQueueRedis(), stopTracing()]);
      } catch (shutdownError) {
        logger.error('Error during worker shutdown cleanup', {
          signal,
          message: shutdownError instanceof Error ? shutdownError.message : String(shutdownError),
        });
      } finally {
        clearTimeout(watchdog);
        process.exit(0);
      }
    };

    process.on('SIGTERM', () => {
      void shutdown('SIGTERM');
    });
    process.on('SIGINT', () => {
      void shutdown('SIGINT');
    });
  } catch (error) {
    const err = error as Error;
    logger.error('Failed to start worker', { message: err.message, stack: err.stack });
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
