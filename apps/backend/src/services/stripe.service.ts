import crypto from 'crypto';
import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';

interface StripeCustomer {
  id: string;
  email: string | null;
  name: string | null;
}

interface StripeSubscription {
  id: string;
  status: string;
  customer: string;
  current_period_start: number;
  current_period_end: number;
  items: {
    data: Array<{
      price: {
        id: string;
      };
    }>;
  };
}

function configError(message: string): AppError {
  const err = new Error(message) as AppError;
  err.statusCode = 500;
  err.isOperational = true;
  return err;
}

function integrationError(message: string): AppError {
  const err = new Error(message) as AppError;
  err.statusCode = 502;
  err.isOperational = true;
  return err;
}

function safeStripeErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return 'unknown error';
  const error = (payload as { error?: { message?: unknown } }).error;
  return typeof error?.message === 'string' && error.message.length > 0 ? error.message : 'unknown error';
}

export class StripeService {
  private readonly apiBase = 'https://api.stripe.com/v1';
  private readonly webhookToleranceSeconds = 300;

  private ensureConfigured(): void {
    if (!env.STRIPE_SECRET_KEY) {
      throw configError('Stripe is not configured: STRIPE_SECRET_KEY is missing');
    }
  }

  private async request<T>(path: string, params: Record<string, string>): Promise<T> {
    this.ensureConfigured();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.HTTP_REQUEST_TIMEOUT_MS);
    const body = new URLSearchParams(params);

    try {
      const response = await fetch(`${this.apiBase}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: controller.signal,
      });

      let payload: ({ error?: { message?: string } } & T) | undefined;
      try {
        payload = await response.json() as { error?: { message?: string } } & T;
      } catch (error) {
        throw integrationError(`Stripe API returned invalid JSON: ${error instanceof Error ? error.message : 'unknown parse error'}`);
      }

      if (!response.ok) {
        throw integrationError(`Stripe API error: ${safeStripeErrorMessage(payload)}`);
      }

      return payload;
    } catch (error) {
      if ((error as AppError).isOperational) {
        throw error;
      }

      const message = error instanceof Error && error.name === 'AbortError'
        ? `Stripe API request timed out after ${env.HTTP_REQUEST_TIMEOUT_MS}ms`
        : `Stripe API request failed: ${error instanceof Error ? error.message : 'unknown error'}`;
      throw integrationError(message);
    } finally {
      clearTimeout(timeout);
    }
  }

  async createCustomer(email: string, name: string, organizationId: string): Promise<StripeCustomer> {
    return this.request<StripeCustomer>('/customers', {
      email,
      name,
      'metadata[organization_id]': organizationId,
    });
  }

  async createSubscription(customerId: string, priceId: string): Promise<StripeSubscription> {
    return this.request<StripeSubscription>('/subscriptions', {
      customer: customerId,
      'items[0][price]': priceId,
      payment_behavior: 'default_incomplete',
      'payment_settings[save_default_payment_method]': 'on_subscription',
      'expand[]': 'latest_invoice.payment_intent',
    });
  }

  private parseSignatureHeader(signatureHeader: string): { timestamp: number; signatures: string[] } | null {
    const elements = signatureHeader.split(',').map((item) => item.trim());
    const timestampRaw = elements.find((item) => item.startsWith('t='))?.slice(2);
    const signatures = elements
      .filter((item) => item.startsWith('v1='))
      .map((item) => item.slice(3))
      .filter((value) => value.length > 0);

    if (!timestampRaw || signatures.length === 0) {
      return null;
    }

    const timestamp = Number.parseInt(timestampRaw, 10);
    if (!Number.isFinite(timestamp)) {
      return null;
    }

    return { timestamp, signatures };
  }

  verifyWebhookSignature(payload: Buffer, signatureHeader: string): boolean {
    if (!env.STRIPE_WEBHOOK_SECRET) {
      throw configError('Stripe is not configured: STRIPE_WEBHOOK_SECRET is missing');
    }

    const parsed = this.parseSignatureHeader(signatureHeader);
    if (!parsed) {
      return false;
    }

    const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - parsed.timestamp);
    if (ageSeconds > this.webhookToleranceSeconds) {
      return false;
    }

    const signedPayload = `${parsed.timestamp}.${payload.toString('utf8')}`;
    const expected = crypto
      .createHmac('sha256', env.STRIPE_WEBHOOK_SECRET)
      .update(signedPayload)
      .digest('hex');

    try {
      return parsed.signatures.some((signature) => crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature)));
    } catch {
      return false;
    }
  }
}
