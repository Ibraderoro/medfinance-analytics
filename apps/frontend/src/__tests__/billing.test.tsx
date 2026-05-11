import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BillingPage } from '../pages/Billing';
import { billingApi } from '../services/api';

jest.mock('../services/api', () => ({
  billingApi: {
    getSubscription: jest.fn(),
    createSubscription: jest.fn(),
  },
}));

describe('BillingPage', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('loads the current subscription and upgrades to Pro', async () => {
    (billingApi.getSubscription as jest.Mock).mockResolvedValueOnce({
      data: { data: { plan: 'free', status: 'inactive' } },
    });
    (billingApi.createSubscription as jest.Mock).mockResolvedValueOnce({
      data: { data: { plan: 'pro', status: 'active' } },
    });

    render(<BillingPage />);

    expect(await screen.findByText('free')).toBeInTheDocument();
    expect(screen.getByText('inactive')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Upgrade to Pro' }));

    await waitFor(() => expect(billingApi.createSubscription).toHaveBeenCalledWith('pro'));
    expect(await screen.findByText('Subscription updated successfully.')).toBeInTheDocument();
    expect(screen.getByText('pro')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
  });

  it('surfaces billing load and update errors', async () => {
    (billingApi.getSubscription as jest.Mock).mockRejectedValueOnce(new Error('unavailable'));
    (billingApi.createSubscription as jest.Mock).mockRejectedValueOnce({
      response: { data: { error: { message: 'Only admins can change subscriptions' } } },
    });

    render(<BillingPage />);

    expect(await screen.findByText('Failed to load billing data.')).toBeInTheDocument();
    expect(screen.getByText('No subscription found.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Upgrade to Pro' }));

    expect(await screen.findByText('Only admins can change subscriptions')).toBeInTheDocument();
  });
});
