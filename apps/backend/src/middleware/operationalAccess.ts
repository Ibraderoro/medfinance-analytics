import crypto from 'crypto';
import { BlockList, isIP } from 'node:net';
import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { logger } from '../utils/logger';

const operationalAllowlist = new BlockList();

function normalizeIp(rawIp: string): string {
  const normalized = rawIp.trim().replace(/^\[|\]$/g, '');
  const withoutScope = normalized.split('%')[0];
  return withoutScope.startsWith('::ffff:') ? withoutScope.slice(7) : withoutScope;
}

function registerAllowlistEntry(entry: string): void {
  const candidate = entry.trim();
  if (!candidate) {
    return;
  }

  if (candidate.includes('/')) {
    const [rawAddress, rawPrefix] = candidate.split('/');
    const address = normalizeIp(rawAddress ?? '');
    const prefix = Number.parseInt(rawPrefix ?? '', 10);
    const version = isIP(address);

    if (!Number.isFinite(prefix) || (version !== 4 && version !== 6)) {
      logger.warn('Skipping invalid OPS allowlist CIDR', { cidr: candidate });
      return;
    }

    operationalAllowlist.addSubnet(address, prefix, version === 4 ? 'ipv4' : 'ipv6');
    return;
  }

  const address = normalizeIp(candidate);
  const version = isIP(address);
  if (version === 0) {
    logger.warn('Skipping invalid OPS allowlist IP', { ip: candidate });
    return;
  }

  operationalAllowlist.addAddress(address, version === 4 ? 'ipv4' : 'ipv6');
}

for (const cidr of env.OPS_ALLOWLIST_CIDRS) {
  registerAllowlistEntry(cidr);
}

function extractClientIp(req: Request): string {
  const ip = req.ip || req.socket.remoteAddress || '';
  return normalizeIp(ip);
}

function extractPresentedToken(req: Request): string {
  const authHeader = req.header('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }

  return (req.header('x-ops-auth-token') ?? '').trim();
}

function hasValidToken(req: Request): boolean {
  if (!env.OPS_ENDPOINT_AUTH_ENABLED) {
    return true;
  }

  const expected = env.OPS_ENDPOINT_AUTH_TOKEN;
  const presented = extractPresentedToken(req);
  if (!expected || !presented) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const presentedBuffer = Buffer.from(presented);
  if (expectedBuffer.length !== presentedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, presentedBuffer);
}

export function enforceOperationalAccess(accessScope: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const clientIp = extractClientIp(req);
    const ipVersion = isIP(clientIp);
    const ipAllowed = ipVersion !== 0 && operationalAllowlist.check(clientIp, ipVersion === 6 ? 'ipv6' : 'ipv4');
    const tokenAllowed = hasValidToken(req);
    const accessMeta = {
      requestId: req.requestId,
      scope: accessScope,
      method: req.method,
      path: req.originalUrl,
      ip: clientIp || 'unknown',
      ipAllowed,
      tokenAllowed,
      authRequired: env.OPS_ENDPOINT_AUTH_ENABLED,
    };

    if (!ipAllowed || !tokenAllowed) {
      logger.warn('Operational endpoint access denied', accessMeta);
      res.status(403).json({
        success: false,
        error: { message: 'Operational endpoint access denied', code: 'OPS_ENDPOINT_RESTRICTED' },
        data: null,
      });
      return;
    }

    logger.info('Operational endpoint access granted', accessMeta);
    next();
  };
}
