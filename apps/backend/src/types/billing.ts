export type SubscriptionPlan = 'free' | 'pro' | 'enterprise';

export interface SubscriptionSnapshot {
  plan: SubscriptionPlan;
  status: string;
}
