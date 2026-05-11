import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

interface MfaDeliveryInput {
  userId: string;
  email: string;
  organizationId: string;
  code: string;
}

export interface MfaDeliveryResult {
  method: 'webhook' | 'test_sink';
}

function configurationError(message: string): AppError {
  const err = new Error(message) as AppError;
  err.statusCode = 500;
  err.isOperational = true;
  return err;
}

function deliveryError(message: string): AppError {
  const err = new Error(message) as AppError;
  err.statusCode = 502;
  err.isOperational = true;
  return err;
}

export class MfaDeliveryService {
  async sendMfaCode(input: MfaDeliveryInput): Promise<MfaDeliveryResult> {
    if (!env.MFA_DELIVERY_WEBHOOK_URL) {
      if (env.isProduction()) {
        throw configurationError('MFA delivery requires MFA_DELIVERY_WEBHOOK_URL in production');
      }

      return { method: 'test_sink' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.HTTP_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(env.MFA_DELIVERY_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: input.userId,
          email: input.email,
          organizationId: input.organizationId,
          code: input.code,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw deliveryError(`MFA delivery provider returned ${response.status}`);
      }

      return { method: 'webhook' };
    } catch (error) {
      if ((error as AppError).isOperational) {
        throw error;
      }

      const isTimeout = error instanceof Error && error.name === 'AbortError';
      logger.error('MFA delivery failed', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        isTimeout,
      });
      const message = isTimeout
        ? `MFA delivery timed out after ${env.HTTP_REQUEST_TIMEOUT_MS}ms`
        : 'MFA delivery failed, please try again';
      throw deliveryError(message);
    } finally {
      clearTimeout(timeout);
    }
  }
}
