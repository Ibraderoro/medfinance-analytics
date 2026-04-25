import 'dotenv/config';
import { app } from './app';
import { logger } from './utils/logger';
import { connectDatabase } from './config/database';
import { connectRedis } from './config/redis';
import { env } from './config/env';

const PORT = Number.parseInt(process.env.PORT ?? `${env.PORT}`, 10);
let server: ReturnType<typeof app.listen> | null = null;

async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received. Shutting down API server...`);

  if (!server) {
    process.exit(0);
  }

  await new Promise<void>((resolve, reject) => {
    server?.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });

  logger.info('Server shutdown completed');
  process.exit(0);
}

async function bootstrap(): Promise<void> {
  try {
    await connectDatabase();
    await connectRedis();

    server = app.listen(PORT, () => {
      logger.info(`🚀 MedFinance API running on port ${PORT} [${env.NODE_ENV}]`);
    });
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

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

bootstrap();
