import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest, requireAuthenticatedUser } from '../middleware/auth';
import { BillingService } from '../services/billing.service';
import { StripeService } from '../services/stripe.service';

const billingService = new BillingService();
const stripeService = new StripeService();

export async function createSubscription(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = requireAuthenticatedUser(req);
    const { plan } = req.body as { plan: 'pro' | 'enterprise' };

    const data = await billingService.createSubscription(user.organization_id, plan);
    res.status(201).json({ data });
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
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

export async function handleStripeWebhook(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const signature = req.headers['stripe-signature'];
    if (typeof signature !== 'string') {
      res.status(400).json({ error: 'Missing Stripe signature' });
      return;
    }

    const payload = req.body as Buffer;
    const isValid = stripeService.verifyWebhookSignature(payload, signature);
    if (!isValid) {
      res.status(400).json({ error: 'Invalid Stripe signature' });
      return;
    }

    const event = JSON.parse(payload.toString('utf8')) as { type: string; data?: { object?: unknown } };
    await billingService.handleWebhookEvent(event);

    res.status(200).json({ received: true });
  } catch (err) {
    next(err);
  }
}
