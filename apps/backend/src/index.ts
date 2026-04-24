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

    app.listen(PORT, () => {
      logger.info(`🚀 MedFinance API running on port ${PORT} [${env.NODE_ENV}]`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

bootstrap();
