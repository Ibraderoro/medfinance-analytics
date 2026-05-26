const mockQuery = jest.fn();

const mockEnv = {
  STRIPE_SECRET_KEY: 'sk_test_billing_lifecycle',
  STRIPE_PRO_PRICE_ID: 'price_pro_lifecycle',
  STRIPE_ENTERPRISE_PRICE_ID: 'price_enterprise_lifecycle',
  STRIPE_WEBHOOK_SECRET: 'whsec_lifecycle',
  HTTP_REQUEST_TIMEOUT_MS: 30000,
  isProduction: () => true,
};

jest.mock('../config/database', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

jest.mock('../config/env', () => ({
  env: mockEnv,
}));

import { BillingService } from '../services/billing.service';

const customerRow = {
  id: 'customer-uuid',
  organization_id: 'org-uuid',
  stripe_customer_id: 'cus_lifecycle',
  email: 'billing@example.com',
};

beforeEach(() => {
  mockQuery.mockReset();
  mockEnv.STRIPE_SECRET_KEY = 'sk_test_billing_lifecycle';
  mockEnv.STRIPE_PRO_PRICE_ID = 'price_pro_lifecycle';
  mockEnv.STRIPE_ENTERPRISE_PRICE_ID = 'price_enterprise_lifecycle';
  jest.restoreAllMocks();
});

describe('BillingService production lifecycle evidence', () => {
  const service = new BillingService();

  it('creates an incomplete Stripe subscription with the selected price and persists the local subscription snapshot', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'sub_created_lifecycle',
        status: 'incomplete',
        customer: 'cus_lifecycle',
        current_period_start: 1767225600,
        current_period_end: 1769904000,
        items: { data: [{ price: { id: 'price_pro_lifecycle' } }] },
      }),
    } as Response);
    mockQuery
      .mockResolvedValueOnce([customerRow])
      .mockResolvedValueOnce([{
        id: 'subscription-uuid',
        organization_id: 'org-uuid',
        stripe_subscription_id: 'sub_created_lifecycle',
        plan: 'pro',
        status: 'incomplete',
        current_period_start: '2026-01-01T00:00:00.000Z',
        current_period_end: '2026-02-01T00:00:00.000Z',
      }])
      .mockResolvedValueOnce([]);

    const result = await service.createSubscription('org-uuid', 'pro');

    expect(result).toMatchObject({
      stripe_subscription_id: 'sub_created_lifecycle',
      plan: 'pro',
      status: 'incomplete',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.stripe.com/v1/subscriptions',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = fetchMock.mock.calls[0][1]?.body as URLSearchParams;
    expect(body.get('customer')).toBe('cus_lifecycle');
    expect(body.get('items[0][price]')).toBe('price_pro_lifecycle');
    expect(body.get('payment_behavior')).toBe('default_incomplete');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (stripe_subscription_id)'),
      expect.arrayContaining(['org-uuid', 'customer-uuid', 'sub_created_lifecycle', 'pro', 'incomplete']),
    );
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE users'),
      ['cus_lifecycle', 'incomplete', 'pro', 'org-uuid'],
    );
  });

  it('reconciles checkout completion without a price as an active free snapshot until invoice details arrive', async () => {
    mockQuery
      .mockResolvedValueOnce([customerRow])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await service.handleWebhookEvent({
      type: 'checkout.session.completed',
      data: { object: { customer: 'cus_lifecycle', subscription: 'sub_checkout_lifecycle' } },
    });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (stripe_subscription_id)'),
      expect.arrayContaining(['org-uuid', 'customer-uuid', 'sub_checkout_lifecycle', 'free', 'active']),
    );
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE users'),
      ['cus_lifecycle', 'active', 'free', 'org-uuid'],
    );
  });

  it('reconciles invoice paid, payment failed, and cancellation events into subscription and user plan state', async () => {
    mockQuery
      .mockResolvedValueOnce([customerRow])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([customerRow])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([customerRow])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await service.handleWebhookEvent({
      type: 'invoice.paid',
      data: {
        object: {
          customer: 'cus_lifecycle',
          subscription: 'sub_lifecycle',
          lines: { data: [{ price: { id: 'price_pro_lifecycle' }, period: { start: 1767225600, end: 1769904000 } }] },
        },
      },
    });
    await service.handleWebhookEvent({
      type: 'invoice.payment_failed',
      data: {
        object: {
          customer: 'cus_lifecycle',
          subscription: 'sub_lifecycle',
          lines: { data: [{ price: { id: 'price_pro_lifecycle' } }] },
        },
      },
    });
    await service.handleWebhookEvent({
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_lifecycle',
          customer: 'cus_lifecycle',
          status: 'canceled',
          current_period_start: 1767225600,
          current_period_end: 1769904000,
          items: { data: [{ price: { id: 'price_pro_lifecycle' } }] },
        },
      },
    });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (stripe_subscription_id)'),
      expect.arrayContaining(['org-uuid', 'customer-uuid', 'sub_lifecycle', 'pro', 'active', 1767225600, 1769904000]),
    );
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (stripe_subscription_id)'),
      expect.arrayContaining(['org-uuid', 'customer-uuid', 'sub_lifecycle', 'pro', 'past_due']),
    );
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (stripe_subscription_id)'),
      expect.arrayContaining(['org-uuid', 'customer-uuid', 'sub_lifecycle', 'pro', 'canceled', 1767225600, 1769904000]),
    );
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE users'),
      ['cus_lifecycle', 'active', 'pro', 'org-uuid'],
    );
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE users'),
      ['cus_lifecycle', 'past_due', 'pro', 'org-uuid'],
    );
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE users'),
      ['cus_lifecycle', 'canceled', 'pro', 'org-uuid'],
    );
  });

  it('records replay-safe webhook reservations and releases retryable failures', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 'evt_lifecycle' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await expect(service.reserveWebhookEvent('evt_lifecycle', 'invoice.paid')).resolves.toBe(true);
    await service.markWebhookEventProcessed('evt_lifecycle');
    await service.releaseWebhookEventReservation('evt_lifecycle_retry');

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (id) DO UPDATE'),
      ['evt_lifecycle', 'invoice.paid', 600],
    );
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'processed'"),
      ['evt_lifecycle'],
    );
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE id = $1 AND status = 'processing'"),
      ['evt_lifecycle_retry'],
    );
  });
});
