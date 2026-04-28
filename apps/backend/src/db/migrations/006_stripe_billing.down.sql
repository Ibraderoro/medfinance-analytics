DROP TRIGGER IF EXISTS trg_subscriptions_updated_at ON subscriptions;
DROP TRIGGER IF EXISTS trg_customers_updated_at ON customers;

DROP TABLE IF EXISTS subscriptions;
DROP TABLE IF EXISTS customers;

DROP FUNCTION IF EXISTS set_updated_at_timestamp();
