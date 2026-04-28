import { Request } from 'express';
import rateLimit from 'express-rate-limit';

function keyByIp(ip: string | undefined): string {
  if (!ip) {
    return 'unknown-ip';
  }

  return ip.trim().toLowerCase();
}

function createRateLimitMessage(message: string, code: string) {
  return {
    success: false,
    error: {
      message,
      code,
    },
  };
}

export const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => keyByIp(req.ip),
  message: createRateLimitMessage('Too many requests from this IP, please try again later.', 'RATE_LIMITED'),
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => keyByIp(req.ip),
  message: createRateLimitMessage(
    'Too many authentication attempts from this IP, please try again later.',
    'AUTH_RATE_LIMITED',
  ),
});
