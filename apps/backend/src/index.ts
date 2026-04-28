import 'dotenv/config';
import { app } from './app';
import { logger } from './utils/logger';
import { connectDatabase, disconnectDatabase } from './config/database';
import { connectRedis, disconnectRedis } from './config/redis';
import { env } from './config/env';
import { liveFinancialsService } from './services/liveFinancials.service';

const PORT = Number.parseInt(process.env.PORT ?? `${env.PORT}`, 10);
const SHUTDOWN_TIMEOUT_MS = 10_000;

let isShuttingDown = false;

app.use((_req, res, next) => {
  if (isShuttingDown) {
    res.setHeader('Connection', 'close');
    res.status(503).json({ message: 'Server is shutting down' });
    return;
  }
  next();
});

async function bootstrap(): Promise<void> {
  try {
    await connectDatabase();
    await connectRedis();

    await liveFinancialsService.start();

    const server = app.listen(PORT, () => {
      logger.info(`🚀 MedFinance API running on port ${PORT} [${env.NODE_ENV}]`);
    });

    const shutdown = async (signal: string) => {
      if (isShuttingDown) {
        return;
      }
      isShuttingDown = true;
      app.locals.isShuttingDown = true;

      logger.info(`Received ${signal}. Shutting down gracefully...`);

      const forcedShutdown = setTimeout(() => {
        logger.error(`Graceful shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms`);
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS);

      server.close(async (error) => {
        try {
          liveFinancialsService.stop();
          await disconnectRedis();
          await disconnectDatabase();
          clearTimeout(forcedShutdown);

          if (error) {
            logger.error('Error during server shutdown', error);
            process.exit(1);
            return;
          }

          process.exit(0);
        } catch (shutdownError) {
          logger.error('Error while closing dependencies during shutdown', shutdownError);
          process.exit(1);
        }
      });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise rejection:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  process.exit(1);
});

bootstrap();
