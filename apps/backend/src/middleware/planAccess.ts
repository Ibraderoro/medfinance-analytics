import { Response, NextFunction } from 'express';
import { AuthenticatedRequest, requireAuthenticatedUser } from './auth';
import { BillingService } from '../services/billing.service';
import { SubscriptionPlan } from '../types/billing';

const billingService = new BillingService();

const PLAN_PRIORITY: Record<SubscriptionPlan, number> = {
  free: 0,
  pro: 1,
  enterprise: 2,
};

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function requireMinimumPlan(minimumPlan: SubscriptionPlan) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = requireAuthenticatedUser(req);
      const subscription = await billingService.getOrganizationSubscription(user.organization_id);

      if (PLAN_PRIORITY[subscription.plan] < PLAN_PRIORITY[minimumPlan]) {
        res.status(403).json({
          error: `${minimumPlan.toUpperCase()} plan required for this feature`,
        });
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

export function enforceFreeHistoryWindow(maxMonths: number) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = requireAuthenticatedUser(req);
      const subscription = await billingService.getOrganizationSubscription(user.organization_id);

      if (subscription.plan !== 'free') {
        next();
        return;
      }

      const startDate = parseDate(req.query.startDate as string | undefined);
      if (!startDate) {
        res.status(403).json({
          error: `Free plan supports up to ${maxMonths} months of financial history. Upgrade to Pro for full analytics.`,
        });
        return;
      }

      const minDate = new Date();
      minDate.setUTCMonth(minDate.getUTCMonth() - maxMonths);

      if (startDate < minDate) {
        res.status(403).json({
          error: `Free plan supports up to ${maxMonths} months of financial history. Upgrade to Pro for full analytics.`,
        });
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
