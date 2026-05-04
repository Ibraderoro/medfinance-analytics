DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['financial_transactions','budgets','compliance_records','transactions','forecasts','compliance_items']
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='organization_id') THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS %I_tenant_rls ON %I', t, t);
      EXECUTE format('CREATE POLICY %I_tenant_rls ON %I FOR ALL USING (organization_id = current_setting(''app.current_tenant_id'', true)::uuid) WITH CHECK (organization_id = current_setting(''app.current_tenant_id'', true)::uuid)', t, t);
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  archive_exists boolean;
  is_partitioned boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'api_request_metrics_archive' AND n.nspname = 'public'
  ) INTO archive_exists;

  SELECT EXISTS (
    SELECT 1
    FROM pg_partitioned_table pt
    JOIN pg_class c ON c.oid = pt.partrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'api_request_metrics_archive' AND n.nspname = 'public'
  ) INTO is_partitioned;

  IF NOT archive_exists THEN
    EXECUTE 'CREATE TABLE api_request_metrics_archive (LIKE api_request_metrics INCLUDING DEFAULTS) PARTITION BY RANGE (created_at)';
  ELSIF NOT is_partitioned THEN
    DECLARE legacy_count bigint;
    DECLARE migrated_count bigint;
    BEGIN
      EXECUTE 'ALTER TABLE api_request_metrics_archive RENAME TO api_request_metrics_archive_legacy';
      EXECUTE 'CREATE TABLE api_request_metrics_archive (LIKE api_request_metrics INCLUDING DEFAULTS) PARTITION BY RANGE (created_at)';
      EXECUTE 'CREATE TABLE api_request_metrics_archive_default PARTITION OF api_request_metrics_archive DEFAULT';
      EXECUTE 'SELECT count(*) FROM api_request_metrics_archive_legacy' INTO legacy_count;
      EXECUTE 'INSERT INTO api_request_metrics_archive SELECT * FROM api_request_metrics_archive_legacy';
      EXECUTE 'SELECT count(*) FROM api_request_metrics_archive' INTO migrated_count;
      IF legacy_count <> migrated_count THEN
        RAISE EXCEPTION 'Archive migration row-count mismatch: legacy %, migrated %', legacy_count, migrated_count;
      END IF;
      EXECUTE 'DROP TABLE api_request_metrics_archive_legacy';
    EXCEPTION WHEN OTHERS THEN
      IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'api_request_metrics_archive_legacy') THEN
        BEGIN
          RAISE WARNING 'Fallback restore running for api_request_metrics_archive from api_request_metrics_archive_legacy';
          EXECUTE 'DROP TABLE IF EXISTS api_request_metrics_archive';
          EXECUTE 'ALTER TABLE api_request_metrics_archive_legacy RENAME TO api_request_metrics_archive';
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
      END IF;
      RAISE;
    END;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS api_request_metrics_archive_default PARTITION OF api_request_metrics_archive DEFAULT;


CREATE OR REPLACE FUNCTION ensure_api_metrics_archive_partition(target_month date)
RETURNS void AS $$
DECLARE
  partition_name text := format('api_request_metrics_archive_%s', to_char(date_trunc('month', target_month), 'YYYY_MM'));
  from_date date := date_trunc('month', target_month)::date;
  to_date date := (date_trunc('month', target_month) + interval '1 month')::date;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = partition_name AND n.nspname = 'public'
  ) THEN
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF api_request_metrics_archive FOR VALUES FROM (%L) TO (%L)',
      partition_name,
      from_date,
      to_date
    );
  END IF;
END;
$$ LANGUAGE plpgsql;
