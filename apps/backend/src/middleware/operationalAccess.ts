import crypto from 'crypto';
import { BlockList, isIP } from 'node:net';
import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { logger } from '../utils/logger';

const operationalAllowlist = new BlockList();

type IpVersion = 'ipv4' | 'ipv6';

type OperationalAccessDecision = {
  requestId?: string;
  scope: string;
  method: string;
  path: string;
  ip: string;
  ipAllowed: boolean;
  tokenAllowed: boolean;
  authRequired: boolean;
  userAgent?: string;
};

function normalizeIp(rawIp: string): string {
  const normalized = rawIp.trim().replace(/^\[|\]$/g, '');
  const withoutScope = normalized.split('%')[0];
  return withoutScope.startsWith('::ffff:') ? withoutScope.slice(7) : withoutScope;
}

function toIpVersion(version: number): IpVersion | undefined {
  if (version === 4) return 'ipv4';
  if (version === 6) return 'ipv6';
  return undefined;
}

function isValidPrefix(prefix: number, version: number): boolean {
  if (!Number.isInteger(prefix) || prefix < 0) return false;
  return version === 4 ? prefix <= 32 : prefix <= 128;
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
    const ipVersion = toIpVersion(version);

    if (!ipVersion || !isValidPrefix(prefix, version)) {
      logger.warn('Skipping invalid OPS allowlist CIDR', { cidr: candidate });
      return;
    }

    operationalAllowlist.addSubnet(address, prefix, ipVersion);
    return;
  }

  const address = normalizeIp(candidate);
  const version = isIP(address);
  const ipVersion = toIpVersion(version);
  if (!ipVersion) {
    logger.warn('Skipping invalid OPS allowlist IP', { ip: candidate });
    return;
  }

  operationalAllowlist.addAddress(address, ipVersion);
}

for (const cidr of env.OPS_ALLOWLIST_CIDRS) {
  registerAllowlistEntry(cidr);
}

function extractClientIp(req: Request): string {
  // Operational access control must be based on the immediate network peer.
  // req.ip can be derived from X-Forwarded-For when Express trusts a proxy,
  // which is useful for application logs but unsafe for backend allowlisting if
  // the service is ever reached directly. Nginx performs original-client CIDR
  // checks on the internal operational listener before proxying here.
  const ip = req.socket.remoteAddress || req.ip || '';
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

function buildDecision(req: Request, accessScope: string): OperationalAccessDecision {
  const clientIp = extractClientIp(req);
  const ipVersionNumber = isIP(clientIp);
  const ipVersion = toIpVersion(ipVersionNumber);
  const ipAllowed = Boolean(ipVersion && operationalAllowlist.check(clientIp, ipVersion));
  const tokenAllowed = hasValidToken(req);

  return {
    requestId: req.requestId,
    scope: accessScope,
    method: req.method,
    path: req.originalUrl,
    ip: clientIp || 'unknown',
    ipAllowed,
    tokenAllowed,
    authRequired: env.OPS_ENDPOINT_AUTH_ENABLED,
    userAgent: req.header('user-agent'),
  };
}

function logOperationalAudit(event: string, decision: OperationalAccessDecision, extra: Record<string, unknown> = {}): void {
  logger.info('Operational endpoint audit', {
    event,
    ...decision,
    ...extra,
  });
}

export function enforceOperationalAccess(accessScope: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const decision = buildDecision(req, accessScope);

    if (!decision.ipAllowed || !decision.tokenAllowed) {
      logger.warn('Operational endpoint access denied', decision);
      logOperationalAudit('denied', decision, { statusCode: 403 });
      res.status(403).json({
        success: false,
        error: { message: 'Operational endpoint access denied', code: 'OPS_ENDPOINT_RESTRICTED' },
        data: null,
      });
      return;
    }

    res.once('finish', () => {
      logOperationalAudit('granted', decision, { statusCode: res.statusCode });
    });
    next();
  };
}
