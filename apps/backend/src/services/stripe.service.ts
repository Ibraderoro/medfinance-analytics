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

export class StripeService {
  private readonly apiBase = 'https://api.stripe.com/v1';

  private ensureConfigured(): void {
    if (!env.STRIPE_SECRET_KEY) {
      throw configError('Stripe is not configured: STRIPE_SECRET_KEY is missing');
    }
  }

  private async request<T>(path: string, params: Record<string, string>): Promise<T> {
    this.ensureConfigured();

    const body = new URLSearchParams(params);
    const response = await fetch(`${this.apiBase}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    const payload = await response.json() as { error?: { message?: string } } & T;

    if (!response.ok) {
      throw integrationError(`Stripe API error: ${payload.error?.message ?? 'unknown error'}`);
    }

    return payload;
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

  verifyWebhookSignature(payload: Buffer, signatureHeader: string): boolean {
    if (!env.STRIPE_WEBHOOK_SECRET) {
      throw configError('Stripe is not configured: STRIPE_WEBHOOK_SECRET is missing');
    }

    const elements = signatureHeader.split(',').map((item) => item.trim());
    const timestamp = elements.find((item) => item.startsWith('t='))?.slice(2);
    const signature = elements.find((item) => item.startsWith('v1='))?.slice(3);

    if (!timestamp || !signature) {
      return false;
    }

    const signedPayload = `${timestamp}.${payload.toString('utf8')}`;
    const expected = crypto
      .createHmac('sha256', env.STRIPE_WEBHOOK_SECRET)
      .update(signedPayload)
      .digest('hex');

    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch {
      return false;
    }
  }
}
