import { query } from '../config/database';
import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';
import { SubscriptionPlan, SubscriptionSnapshot } from '../types/billing';
import { StripeService } from './stripe.service';

interface CustomerRow {
  id: string;
  organization_id: string;
  stripe_customer_id: string;
  email: string;
}

interface SubscriptionRow {
  id: string;
  organization_id: string;
  stripe_subscription_id: string;
  plan: SubscriptionPlan;
  status: string;
  current_period_start: string | null;
  current_period_end: string | null;
}


interface StripeWebhookInvoice {
  customer: string;
  subscription: string;
  status: string;
  lines?: {
    data?: Array<{
      price?: {
        id?: string;
      };
      period?: {
        start?: number;
        end?: number;
      };
    }>;
  };
}

interface StripeWebhookSubscription {
  id: string;
  customer: string;
  status: string;
  current_period_start?: number;
  current_period_end?: number;
  items?: {
    data?: Array<{
      price?: {
        id?: string;
      };
    }>;
  };
}

function badRequest(message: string): AppError {
  const err = new Error(message) as AppError;
  err.statusCode = 400;
  err.isOperational = true;
  return err;
}

function configurationError(message: string): AppError {
  const err = new Error(message) as AppError;
  err.statusCode = 500;
  err.isOperational = true;
  return err;
}


export class BillingService {

  async reserveWebhookEvent(eventId: string, eventType: string): Promise<boolean> {
    const rows = await query<{ id: string }>(
      `INSERT INTO stripe_webhook_events (id, event_type, status)
       VALUES ($1, $2, 'processing')
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [eventId, eventType],
    );

    return rows.length > 0;
  }

  async markWebhookEventProcessed(eventId: string): Promise<void> {
    await query(
      `UPDATE stripe_webhook_events
       SET status = 'processed', processed_at = NOW()
       WHERE id = $1`,
      [eventId],
    );
  }

  async releaseWebhookEventReservation(eventId: string): Promise<void> {
    await query(
      `DELETE FROM stripe_webhook_events
       WHERE id = $1 AND status = 'processing'`,
      [eventId],
    );
  }
  private async upsertStripeSubscription(input: {
    stripeCustomerId: string;
    stripeSubscriptionId: string;
    status: string;
    priceId?: string;
    currentPeriodStart?: number;
    currentPeriodEnd?: number;
  }): Promise<void> {
    const plan = this.resolvePlanFromPrice(input.priceId);

    const [customer] = await query<CustomerRow>(
      `SELECT id, organization_id, stripe_customer_id, email
       FROM customers
       WHERE stripe_customer_id = $1`,
      [input.stripeCustomerId],
    );

    if (!customer) {
      return;
    }

    await query(
      `INSERT INTO subscriptions (
         organization_id,
         customer_id,
         stripe_subscription_id,
         plan,
         status,
         current_period_start,
         current_period_end
       ) VALUES ($1, $2, $3, $4, $5, to_timestamp($6), to_timestamp($7))
       ON CONFLICT (stripe_subscription_id)
       DO UPDATE SET
         plan = EXCLUDED.plan,
         status = EXCLUDED.status,
         current_period_start = EXCLUDED.current_period_start,
         current_period_end = EXCLUDED.current_period_end,
         updated_at = NOW()`,
      [
        customer.organization_id,
        customer.id,
        input.stripeSubscriptionId,
        plan,
        input.status,
        input.currentPeriodStart ?? null,
        input.currentPeriodEnd ?? null,
      ],
    );


    await query(
      `UPDATE users
       SET stripe_customer_id = $1,
           subscription_status = $2,
           plan = $3,
           updated_at = NOW()
       WHERE organization_id = $4`,
      [customer.stripe_customer_id, input.status, plan, customer.organization_id],
    );
  }

  private readonly stripe = new StripeService();

  private getPriceIdForPlan(plan: Exclude<SubscriptionPlan, 'free'>): string {
    const value = plan === 'pro' ? env.STRIPE_PRO_PRICE_ID : env.STRIPE_ENTERPRISE_PRICE_ID;
    if (!value) {
      throw badRequest(`Missing Stripe price configuration for ${plan} plan`);
    }
    return value;
  }

  private resolvePlanFromPrice(priceId?: string): SubscriptionPlan {
    if (!priceId) return 'free';
    if (priceId === env.STRIPE_PRO_PRICE_ID) return 'pro';
    if (priceId === env.STRIPE_ENTERPRISE_PRICE_ID) return 'enterprise';
    return 'free';
  }

  ensureProductionCustomerProvisioningConfigured(): void {
    if (!env.STRIPE_SECRET_KEY && env.isProduction()) {
      throw configurationError('Stripe customer provisioning requires STRIPE_SECRET_KEY in production');
    }
  }

  async ensureCustomerForOrganization(
    organizationId: string,
    email: string,
    fullName: string,
  ): Promise<CustomerRow> {
    const [existing] = await query<CustomerRow>(
      `SELECT id, organization_id, stripe_customer_id, email
       FROM customers
       WHERE organization_id = $1`,
      [organizationId],
    );

    if (existing) {
      return existing;
    }

    this.ensureProductionCustomerProvisioningConfigured();

    const stripeCustomer = env.STRIPE_SECRET_KEY
      ? await this.stripe.createCustomer(email, fullName, organizationId)
      : {
        id: `cus_local_${organizationId.replace(/-/g, '').slice(0, 14)}`,
        email,
      };

    const [created] = await query<CustomerRow>(
      `INSERT INTO customers (organization_id, stripe_customer_id, email)
       VALUES ($1, $2, $3)
       RETURNING id, organization_id, stripe_customer_id, email`,
      [organizationId, stripeCustomer.id, stripeCustomer.email ?? email],
    );

    return created;
  }

  async getOrganizationSubscription(organizationId: string): Promise<SubscriptionSnapshot> {
    const [subscription] = await query<SubscriptionRow>(
      `SELECT id, organization_id, stripe_subscription_id, plan, status, current_period_start, current_period_end
       FROM subscriptions
       WHERE organization_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [organizationId],
    );

    if (!subscription) {
      return {
        plan: 'free',
        status: 'inactive',
      };
    }

    return {
      plan: subscription.plan,
      status: subscription.status,
    };
  }

  async createSubscription(organizationId: string, plan: Exclude<SubscriptionPlan, 'free'>) {
    const [customer] = await query<CustomerRow>(
      `SELECT id, organization_id, stripe_customer_id, email
       FROM customers
       WHERE organization_id = $1`,
      [organizationId],
    );

    if (!customer) {
      throw badRequest('No Stripe customer found for organization');
    }

    const priceId = this.getPriceIdForPlan(plan);
    const stripeSubscription = await this.stripe.createSubscription(customer.stripe_customer_id, priceId);

    const [saved] = await query<SubscriptionRow>(
      `INSERT INTO subscriptions (
         organization_id,
         customer_id,
         stripe_subscription_id,
         plan,
         status,
         current_period_start,
         current_period_end
       ) VALUES ($1, $2, $3, $4, $5, to_timestamp($6), to_timestamp($7))
       ON CONFLICT (stripe_subscription_id)
       DO UPDATE SET
         plan = EXCLUDED.plan,
         status = EXCLUDED.status,
         current_period_start = EXCLUDED.current_period_start,
         current_period_end = EXCLUDED.current_period_end,
         updated_at = NOW()
       RETURNING id, organization_id, stripe_subscription_id, plan, status, current_period_start, current_period_end`,
      [
        organizationId,
        customer.id,
        stripeSubscription.id,
        plan,
        stripeSubscription.status,
        stripeSubscription.current_period_start,
        stripeSubscription.current_period_end,
      ],
    );

    await query(
      `UPDATE users
       SET stripe_customer_id = $1,
           subscription_status = $2,
           plan = $3,
           updated_at = NOW()
       WHERE organization_id = $4`,
      [customer.stripe_customer_id, saved.status, saved.plan, organizationId],
    );

    return saved;
  }

  async handleWebhookEvent(event: { type: string; data?: { object?: unknown } }): Promise<void> {
    if (!event.data?.object) {
      return;
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as { customer?: string; subscription?: string };
      if (session.customer && session.subscription) {
        await this.upsertStripeSubscription({
          stripeCustomerId: session.customer,
          stripeSubscriptionId: session.subscription,
          status: 'active',
        });
      }
      return;
    }

    if (event.type === 'invoice.paid') {
      const invoice = event.data.object as StripeWebhookInvoice;
      await this.upsertStripeSubscription({
        stripeCustomerId: invoice.customer,
        stripeSubscriptionId: invoice.subscription,
        status: 'active',
        priceId: invoice.lines?.data?.[0]?.price?.id,
        currentPeriodStart: invoice.lines?.data?.[0]?.period?.start,
        currentPeriodEnd: invoice.lines?.data?.[0]?.period?.end,
      });
      return;
    }

    if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object as StripeWebhookInvoice;
      await this.upsertStripeSubscription({
        stripeCustomerId: invoice.customer,
        stripeSubscriptionId: invoice.subscription,
        status: 'past_due',
        priceId: invoice.lines?.data?.[0]?.price?.id,
      });
      return;
    }

    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object as StripeWebhookSubscription;
      await this.upsertStripeSubscription({
        stripeCustomerId: subscription.customer,
        stripeSubscriptionId: subscription.id,
        status: 'canceled',
        priceId: subscription.items?.data?.[0]?.price?.id,
        currentPeriodStart: subscription.current_period_start,
        currentPeriodEnd: subscription.current_period_end,
      });
    }
  }
}