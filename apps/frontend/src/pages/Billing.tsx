import { useEffect, useState } from 'react';
import { billingApi } from '../services/api';
import { Card } from '../components/common/Card';
import { Loading } from '../components/common/Loading';
import styles from './Page.module.css';

type SubscriptionSnapshot = {
  plan: string;
  status: string;
};

export function BillingPage() {
  const [subscription, setSubscription] = useState<SubscriptionSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpgrading, setIsUpgrading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    billingApi
      .getSubscription()
      .then((res) => {
        if (!cancelled) setSubscription(res.data.data as SubscriptionSnapshot);
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load billing data.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  const upgrade = async () => {
    setIsUpgrading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await billingApi.createSubscription('pro');
      setSubscription(res.data.data as SubscriptionSnapshot);
      setMessage('Subscription updated successfully.');
    } catch (err: unknown) {
      const serverMessage = typeof err === 'object' && err !== null && 'response' in err
        ? (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
        : undefined;
      setError(serverMessage ?? 'Unable to update subscription.');
    } finally {
      setIsUpgrading(false);
    }
  };

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Billing</h1>
      {isLoading && <Loading />}
      {!isLoading && (
        <Card title="Subscription">
          {error && <p className={styles.error}>{error}</p>}
          {message && <p>{message}</p>}
          {subscription ? (
            <dl>
              <dt>Plan</dt>
              <dd>{subscription.plan}</dd>
              <dt>Status</dt>
              <dd>{subscription.status}</dd>
            </dl>
          ) : (
            <p>No subscription found.</p>
          )}
          <button type="button" onClick={() => void upgrade()} disabled={isUpgrading}>
            {isUpgrading ? 'Upgrading…' : 'Upgrade to Pro'}
          </button>
        </Card>
      )}
    </div>
  );
}
