DROP INDEX IF EXISTS idx_users_plan;
DROP INDEX IF EXISTS idx_users_subscription_status;
DROP INDEX IF EXISTS idx_users_stripe_customer_id;

ALTER TABLE users
  DROP COLUMN IF EXISTS plan,
  DROP COLUMN IF EXISTS subscription_status,
  DROP COLUMN IF EXISTS stripe_customer_id;
