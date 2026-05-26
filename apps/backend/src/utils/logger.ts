import winston from 'winston';

const { combine, timestamp, errors, json } = winston.format;
const ALLOWED_LOG_LEVELS = new Set(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly']);

function getValidatedLogLevel(value = process.env.LOG_LEVEL): string {
  return value && ALLOWED_LOG_LEVELS.has(value) ? value : 'info';
}

export const logger = winston.createLogger({
  level: getValidatedLogLevel(),
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
