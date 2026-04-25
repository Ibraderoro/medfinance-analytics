import 'dotenv/config';
import { app } from './app';
import { logger } from './utils/logger';
import { connectDatabase } from './config/database';
import { connectRedis } from './config/redis';
import { env } from './config/env';

const PORT = env.PORT;

async function bootstrap(): Promise<void> {
  try {
    await connectDatabase();
    await connectRedis();

    const server = app.listen(PORT, () => {
      logger.info(`🚀 MedFinance API running on port ${PORT} [${env.NODE_ENV}]`);
    });

    const shutdown = (signal: string) => {
      logger.info(`Received ${signal}. Shutting down gracefully...`);
      server.close((error) => {
        if (error) {
          logger.error('Error during server shutdown', error);
          process.exit(1);
          return;
        }
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

bootstrap();
