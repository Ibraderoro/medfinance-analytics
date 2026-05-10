import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest, requireAuthenticatedUser } from '../middleware/auth';
import { BillingService } from '../services/billing.service';
import { StripeService } from '../services/stripe.service';
import { getRedis } from '../config/redis';

const billingService = new BillingService();
const stripeService = new StripeService();
const redis = getRedis();
const WEBHOOK_EVENT_DEDUP_TTL_SECONDS = 60 * 60 * 24;

export async function createSubscription(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = requireAuthenticatedUser(req);
    const { plan } = req.body as { plan: 'pro' | 'enterprise' };

    const data = await billingService.createSubscription(user.organization_id, plan);
    res.success(data, 201);
  } catch (err) {
    next(err);
  }
}

export async function getCurrentSubscription(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = requireAuthenticatedUser(req);
    const data = await billingService.getOrganizationSubscription(user.organization_id);
    res.success(data);
  } catch (err) {
    next(err);
  }
}

export async function handleStripeWebhook(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  let dedupKey: string | undefined;

  try {
    const signature = req.headers['stripe-signature'];
    if (typeof signature !== 'string') {
      res.status(400).json({
        success: false,
        error: { message: 'Missing Stripe signature', code: 'BILLING_WEBHOOK_SIGNATURE_MISSING' },
        data: null,
      });
      return;
    }

    const payload = req.body as Buffer;
    const isValid = stripeService.verifyWebhookSignature(payload, signature);
    if (!isValid) {
      res.status(400).json({
        success: false,
        error: { message: 'Invalid Stripe signature', code: 'BILLING_WEBHOOK_SIGNATURE_INVALID' },
        data: null,
      });
      return;
    }

    let event: { id?: string; type: string; data?: { object?: unknown } };
    try {
      event = JSON.parse(payload.toString('utf8')) as { id?: string; type: string; data?: { object?: unknown } };
    } catch {
      res.status(400).json({
        success: false,
        error: { message: 'Invalid Stripe webhook JSON payload', code: 'BILLING_WEBHOOK_INVALID_JSON' },
        data: null,
      });
      return;
    }

    if (event.id) {
      dedupKey = `billing:webhook:event:${event.id}`;
      const accepted = await redis.set(dedupKey, '1', 'EX', WEBHOOK_EVENT_DEDUP_TTL_SECONDS, 'NX');
      if (accepted === null) {
        res.success({ received: true, duplicate: true });
        return;
      }
    }

    try {
      await billingService.handleWebhookEvent(event);
    } catch (err) {
      if (dedupKey) {
        try {
          await redis.del(dedupKey);
        } catch {
          // Preserve the original webhook processing error so Stripe can retry the event.
        }
      }
      throw err;
    }

    res.success({ received: true });
  } catch (err) {
    next(err);
  }
}
