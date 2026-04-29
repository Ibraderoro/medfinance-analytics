import winston from 'winston';
import { env } from '../config/env';

const { combine, timestamp, errors, json } = winston.format;

export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  format: combine(
    timestamp(),
    errors({ stack: true }),
    json(),
  ),
  defaultMeta: { service: 'medfinance-backend' },
  transports: [
    new winston.transports.Console({
      format: combine(timestamp(), errors({ stack: true }), json()),
    }),
  ],
});
