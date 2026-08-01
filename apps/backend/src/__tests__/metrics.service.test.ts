import { classifySqlOperation, metricsService } from '../services/metrics.service';

describe('Prometheus metrics service', () => {
  it('classifies SQL operations coarsely without using query text as a label', () => {
    expect(classifySqlOperation(' select * from users where id = $1')).toBe('SELECT');
    expect(classifySqlOperation('\nINSERT INTO users(id) VALUES ($1)')).toBe('INSERT');
    expect(classifySqlOperation('with recent as (select 1) select * from recent')).toBe('WITH');
    expect(classifySqlOperation('vacuum analyze')).toBe('OTHER');
  });

  it('renders multi-instance-safe counters and histograms for HTTP, PostgreSQL, and Redis', () => {
    metricsService.recordRequest(125, {
      method: 'get',
      route: '/api/v1/test/:id',
      status_code: 200,
      status_class: '2xx',
      outcome: 'success',
    });
    metricsService.recordRequest(2500, {
      method: 'POST',
      route: '/api/v1/test',
      status_code: 503,
      outcome: 'error',
    });
    metricsService.recordDbQuery(12, { operation: 'select', status: 'success', db_system: 'postgresql' });
    metricsService.recordDbQuery(30, { operation: 'update', status: 'error', db_system: 'postgresql' });
    metricsService.recordRedisOperation(4, { operation: 'get', status: 'success', db_system: 'redis' });
    metricsService.recordRedisOperation(8, { operation: 'set', status: 'error', db_system: 'redis' });

    const prometheus = metricsService.toPrometheus();
    expect(prometheus).toContain('# TYPE http_server_requests_total counter');
    expect(prometheus).toContain('http_server_requests_total{method="GET",outcome="success",route="/api/v1/test/:id",status_class="2xx",status_code="200"}');
    expect(prometheus).toContain('http_server_request_duration_seconds_bucket');
    expect(prometheus).toContain('db_client_queries_total{db_system="postgresql",operation="UPDATE",status="error"}');
    expect(prometheus).toContain('db_client_query_duration_seconds_bucket');
    expect(prometheus).toContain('redis_client_operations_total{db_system="redis",operation="SET",status="error"}');
    expect(prometheus).toContain('redis_client_operation_duration_seconds_bucket');

    expect(metricsService.getSnapshot()).toEqual(expect.objectContaining({
      metricsMode: 'prometheus_histograms',
      aggregation: 'prometheus_multi_instance_safe',
    }));
  });

  it('keeps backward-compatible recording methods while avoiding percentile gauges', () => {
    metricsService.recordRequest(1, true);
    metricsService.recordDbQuery(1);
    metricsService.recordRedisOperation(1);

    const prometheus = metricsService.toPrometheus();
    expect(prometheus).not.toContain('p95_ms');
    expect(prometheus).not.toContain('duration_p95');
  });

  it('records queue job outcomes and dead-letter counts', () => {
    metricsService.recordQueueJob(120, { queue: 'billing.webhook-processing', outcome: 'success' });
    metricsService.recordQueueJob(45, { queue: 'billing.webhook-processing', outcome: 'failure' });
    metricsService.recordQueueDeadLetter({ queue: 'billing.webhook-processing' });

    const prometheus = metricsService.toPrometheus();
    expect(prometheus).toContain('# TYPE queue_jobs_total counter');
    expect(prometheus).toContain('queue_jobs_total{outcome="success",queue="billing.webhook-processing"}');
    expect(prometheus).toContain('queue_jobs_total{outcome="failure",queue="billing.webhook-processing"}');
    expect(prometheus).toContain('# TYPE queue_job_duration_seconds histogram');
    expect(prometheus).toContain('queue_job_duration_seconds_bucket');
    expect(prometheus).toContain('# TYPE queue_job_dead_letter_total counter');
    expect(prometheus).toContain('queue_job_dead_letter_total{queue="billing.webhook-processing"} 1');
  });

  it('renders queue depth as a gauge that overwrites to the latest value per queue/state', () => {
    metricsService.recordQueueDepth({ queue: 'analytics.telemetry-persist', state: 'waiting' }, 3);
    metricsService.recordQueueDepth({ queue: 'analytics.telemetry-persist', state: 'waiting' }, 7);

    const prometheus = metricsService.toPrometheus();
    expect(prometheus).toContain('# TYPE queue_depth_current gauge');
    expect(prometheus).toContain('queue_depth_current{queue="analytics.telemetry-persist",state="waiting"} 7');
    expect(prometheus).not.toContain('queue_depth_current{queue="analytics.telemetry-persist",state="waiting"} 3');
  });
});
