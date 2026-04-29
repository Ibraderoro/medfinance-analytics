type MetricSample = {
  timestamp: number;
  durationMs: number;
  isError: boolean;
};

export type MetricsSnapshot = {
  requestCount: number;
  errorCount: number;
  errorRate: number;
  p95LatencyMs: number;
};

class InMemoryMetricsService {
  private requestCount = 0;

  private errorCount = 0;

  private samples: MetricSample[] = [];

  private readonly maxSamples = 10_000;

  recordRequest(durationMs: number, isError: boolean): void {
    this.requestCount += 1;
    if (isError) {
      this.errorCount += 1;
    }

    this.samples.push({
      timestamp: Date.now(),
      durationMs,
      isError,
    });

    if (this.samples.length > this.maxSamples) {
      this.samples.splice(0, this.samples.length - this.maxSamples);
    }
  }

  getSnapshot(): MetricsSnapshot {
    const latencies = this.samples.map((sample) => sample.durationMs).sort((a, b) => a - b);
    const p95Index = latencies.length === 0 ? 0 : Math.max(Math.ceil(latencies.length * 0.95) - 1, 0);
    const p95LatencyMs = latencies.length === 0 ? 0 : latencies[p95Index];

    return {
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      errorRate: this.requestCount === 0 ? 0 : this.errorCount / this.requestCount,
      p95LatencyMs,
    };
  }

  toPrometheus(): string {
    const snapshot = this.getSnapshot();

    return [
      '# HELP http_requests_total Total HTTP requests observed',
      '# TYPE http_requests_total counter',
      `http_requests_total ${snapshot.requestCount}`,
      '# HELP http_errors_total Total HTTP error responses observed',
      '# TYPE http_errors_total counter',
      `http_errors_total ${snapshot.errorCount}`,
      '# HELP http_error_rate Ratio of requests with error status (>=500)',
      '# TYPE http_error_rate gauge',
      `http_error_rate ${snapshot.errorRate}`,
      '# HELP http_request_duration_p95_ms 95th percentile request latency in milliseconds',
      '# TYPE http_request_duration_p95_ms gauge',
      `http_request_duration_p95_ms ${snapshot.p95LatencyMs}`,
    ].join('\n');
  }
}

export const metricsService = new InMemoryMetricsService();
