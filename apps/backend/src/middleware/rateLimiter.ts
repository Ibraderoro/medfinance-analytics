import rateLimit from 'express-rate-limit';

function keyByIp(ip: string | undefined): string {
  if (!ip) {
    return 'unknown-ip';
  }

  return ip.trim().toLowerCase();
}

export const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => keyByIp(req.ip),
  message: {
    error: 'Too many requests from this IP, please try again later.',
  },
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => keyByIp(req.ip),
  message: {
    error: 'Too many authentication attempts from this IP, please try again later.',
  },
});
