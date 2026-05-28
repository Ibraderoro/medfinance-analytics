export type MetricsSnapshot = {
  requestCount: number;
  errorCount: number;
  errorRate: number;
  p95LatencyMs: number;
  dbQueryCount: number;
  dbP95LatencyMs: number;
  redisOperationCount: number;
  redisP95LatencyMs: number;
};

type DurationSample = { timestamp: number; durationMs: number };

class DurationWindow {
  private readonly samples: DurationSample[] = [];

  constructor(private readonly maxSamples = 10000) {}

  push(durationMs: number): void {
    this.samples.push({ timestamp: Date.now(), durationMs });
    if (this.samples.length > this.maxSamples) {
      this.samples.splice(0, this.samples.length - this.maxSamples);
    }
  }

  getP95(): number {
    const latencies = this.samples.map((sample) => sample.durationMs).sort((a, b) => a - b);
    const p95Index = latencies.length === 0 ? 0 : Math.max(Math.ceil(latencies.length * 0.95) - 1, 0);
    return latencies.length === 0 ? 0 : latencies[p95Index];
  }
}

class InMemoryMetricsService {
  private requestCount = 0;
  private errorCount = 0;
  private readonly requestDurations = new DurationWindow();
  private dbQueryCount = 0;
  private readonly dbDurations = new DurationWindow();
  private redisOperationCount = 0;
  private readonly redisDurations = new DurationWindow();

  recordRequest(durationMs: number, isError: boolean): void {
    this.requestCount += 1;
    if (isError) this.errorCount += 1;
    this.requestDurations.push(durationMs);
  }

  recordDbQuery(durationMs: number): void {
    this.dbQueryCount += 1;
    this.dbDurations.push(durationMs);
  }

  recordRedisOperation(durationMs: number): void {
    this.redisOperationCount += 1;
    this.redisDurations.push(durationMs);
  }

  getSnapshot(): MetricsSnapshot {
    return {
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      errorRate: this.requestCount === 0 ? 0 : this.errorCount / this.requestCount,
      p95LatencyMs: this.requestDurations.getP95(),
      dbQueryCount: this.dbQueryCount,
      dbP95LatencyMs: this.dbDurations.getP95(),
      redisOperationCount: this.redisOperationCount,
      redisP95LatencyMs: this.redisDurations.getP95(),
    };
  }

  toPrometheus(): string {
    const s = this.getSnapshot();
    return [
      '# HELP http_requests_total Total HTTP requests observed',
      '# TYPE http_requests_total counter',
      `http_requests_total ${s.requestCount}`,
      '# HELP http_errors_total Total HTTP error responses observed',
      '# TYPE http_errors_total counter',
      `http_errors_total ${s.errorCount}`,
      '# HELP http_error_rate Ratio of requests with error status (>=500)',
      '# TYPE http_error_rate gauge',
      `http_error_rate ${s.errorRate}`,
      '# HELP http_request_duration_p95_ms 95th percentile request latency in milliseconds',
      '# TYPE http_request_duration_p95_ms gauge',
      `http_request_duration_p95_ms ${s.p95LatencyMs}`,
      '# HELP db_queries_total Total database queries observed',
      '# TYPE db_queries_total counter',
      `db_queries_total ${s.dbQueryCount}`,
      '# HELP db_query_duration_p95_ms 95th percentile database query latency in milliseconds',
      '# TYPE db_query_duration_p95_ms gauge',
      `db_query_duration_p95_ms ${s.dbP95LatencyMs}`,
      '# HELP redis_operations_total Total redis operations observed',
      '# TYPE redis_operations_total counter',
      `redis_operations_total ${s.redisOperationCount}`,
      '# HELP redis_operation_duration_p95_ms 95th percentile redis operation latency in milliseconds',
      '# TYPE redis_operation_duration_p95_ms gauge',
      `redis_operation_duration_p95_ms ${s.redisP95LatencyMs}`,
    ].join('\n');
  }
}

export const metricsService = new InMemoryMetricsService();
