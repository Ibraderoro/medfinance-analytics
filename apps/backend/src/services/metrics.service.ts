type LabelValue = string | number | boolean | undefined;
type Labels = Record<string, LabelValue>;

type HistogramDefinition = {
  name: string;
  help: string;
  buckets: number[];
};

type HistogramState = {
  labels: Record<string, string>;
  buckets: number[];
  counts: number[];
  sum: number;
  count: number;
};

export type MetricsSnapshot = {
  httpRequestCount: number;
  httpErrorCount: number;
  dbQueryCount: number;
  dbQueryErrorCount: number;
  redisOperationCount: number;
  redisOperationErrorCount: number;
  metricsMode: 'prometheus_histograms';
  aggregation: 'prometheus_multi_instance_safe';
};

const HTTP_DURATION: HistogramDefinition = {
  name: 'http_server_request_duration_seconds',
  help: 'HTTP server request duration in seconds by method, route, and status code.',
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
};

const DB_DURATION: HistogramDefinition = {
  name: 'db_client_query_duration_seconds',
  help: 'Database client query duration in seconds by operation and status.',
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
};

const REDIS_DURATION: HistogramDefinition = {
  name: 'redis_client_operation_duration_seconds',
  help: 'Redis client operation duration in seconds by operation and status.',
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
};

function sanitizeLabelValue(value: LabelValue): string {
  const normalized = value === undefined || value === '' ? 'unknown' : String(value);
  return normalized.replace(/[\n\r\\"]/g, '_').slice(0, 180);
}

function labelsKey(labels: Record<string, string>): string {
  return Object.keys(labels).sort().map((key) => `${key}=${labels[key]}`).join('|');
}

function renderLabels(labels: Record<string, string>): string {
  const entries = Object.keys(labels).sort().map((key) => `${key}="${labels[key]}"`);
  return entries.length > 0 ? `{${entries.join(',')}}` : '';
}

function statusClass(statusCode: number): string {
  if (!Number.isFinite(statusCode) || statusCode < 100) return 'unknown';
  return `${Math.floor(statusCode / 100)}xx`;
}

function outcome(statusCode: number): string {
  if (statusCode >= 500) return 'error';
  if (statusCode >= 400) return 'client_error';
  return 'success';
}

export function classifySqlOperation(text: string): string {
  const match = /^\s*(select|insert|update|delete|with|begin|commit|rollback|create|alter|drop|truncate)\b/i.exec(text);
  return (match?.[1] ?? 'other').toUpperCase();
}

class PrometheusMetricsService {
  private readonly counters = new Map<string, { name: string; help: string; labels: Record<string, string>; value: number }>();
  private readonly histograms = new Map<string, HistogramState>();
  private httpRequestCount = 0;
  private httpErrorCount = 0;
  private dbQueryCount = 0;
  private dbQueryErrorCount = 0;
  private redisOperationCount = 0;
  private redisOperationErrorCount = 0;
  private readonly startedAt = Date.now();

  recordRequest(durationMs: number, isErrorOrLabels: boolean | Labels = false): void {
    const labels = typeof isErrorOrLabels === 'boolean'
      ? { method: 'UNKNOWN', route: 'unknown', status_code: isErrorOrLabels ? '500' : '200' }
      : isErrorOrLabels;
    const statusCode = Number(labels.status_code ?? 0);
    const normalized = {
      method: sanitizeLabelValue(labels.method).toUpperCase(),
      route: sanitizeLabelValue(labels.route),
      status_code: sanitizeLabelValue(labels.status_code),
      status_class: statusClass(statusCode),
      outcome: sanitizeLabelValue(labels.outcome ?? outcome(statusCode)),
    };

    this.httpRequestCount += 1;
    if (statusCode >= 500 || normalized.outcome === 'error') this.httpErrorCount += 1;
    this.incrementCounter('http_server_requests_total', 'Total HTTP requests by method, route, status code, and outcome.', normalized);
    this.observeHistogram(HTTP_DURATION, durationMs / 1000, normalized);
  }

  recordDbQuery(durationMs: number, operationOrLabels: string | Labels = 'UNKNOWN', status = 'success'): void {
    const labels = typeof operationOrLabels === 'string' ? { operation: operationOrLabels, status } : operationOrLabels;
    const normalized = {
      db_system: sanitizeLabelValue(labels.db_system ?? 'postgresql'),
      operation: sanitizeLabelValue(labels.operation).toUpperCase(),
      status: sanitizeLabelValue(labels.status ?? 'success'),
    };

    this.dbQueryCount += 1;
    if (normalized.status !== 'success') this.dbQueryErrorCount += 1;
    this.incrementCounter('db_client_queries_total', 'Total database queries by operation and status.', normalized);
    this.observeHistogram(DB_DURATION, durationMs / 1000, normalized);
  }

  recordRedisOperation(durationMs: number, operationOrLabels: string | Labels = 'UNKNOWN', status = 'success'): void {
    const labels = typeof operationOrLabels === 'string' ? { operation: operationOrLabels, status } : operationOrLabels;
    const normalized = {
      db_system: sanitizeLabelValue(labels.db_system ?? 'redis'),
      operation: sanitizeLabelValue(labels.operation).toUpperCase(),
      status: sanitizeLabelValue(labels.status ?? 'success'),
    };

    this.redisOperationCount += 1;
    if (normalized.status !== 'success') this.redisOperationErrorCount += 1;
    this.incrementCounter('redis_client_operations_total', 'Total Redis operations by operation and status.', normalized);
    this.observeHistogram(REDIS_DURATION, durationMs / 1000, normalized);
  }

  getSnapshot(): MetricsSnapshot {
    return {
      httpRequestCount: this.httpRequestCount,
      httpErrorCount: this.httpErrorCount,
      dbQueryCount: this.dbQueryCount,
      dbQueryErrorCount: this.dbQueryErrorCount,
      redisOperationCount: this.redisOperationCount,
      redisOperationErrorCount: this.redisOperationErrorCount,
      metricsMode: 'prometheus_histograms',
      aggregation: 'prometheus_multi_instance_safe',
    };
  }

  toPrometheus(): string {
    const lines = [
      '# HELP process_start_time_seconds Unix timestamp when this process started.',
      '# TYPE process_start_time_seconds gauge',
      `process_start_time_seconds ${Math.floor(this.startedAt / 1000)}`,
    ];

    const renderedCounters = new Set<string>();
    for (const counter of this.counters.values()) {
      if (!renderedCounters.has(counter.name)) {
        lines.push(`# HELP ${counter.name} ${counter.help}`, `# TYPE ${counter.name} counter`);
        renderedCounters.add(counter.name);
      }
      lines.push(`${counter.name}${renderLabels(counter.labels)} ${counter.value}`);
    }

    const renderedHistograms = new Set<string>();
    for (const [key, histogram] of this.histograms) {
      const name = key.split('|', 1)[0];
      const definition = [HTTP_DURATION, DB_DURATION, REDIS_DURATION].find((item) => item.name === name);
      if (definition && !renderedHistograms.has(name)) {
        lines.push(`# HELP ${name} ${definition.help}`, `# TYPE ${name} histogram`);
        renderedHistograms.add(name);
      }
      histogram.buckets.forEach((bucket, index) => {
        lines.push(`${name}_bucket${renderLabels({ ...histogram.labels, le: String(bucket) })} ${histogram.counts[index]}`);
      });
      lines.push(`${name}_bucket${renderLabels({ ...histogram.labels, le: '+Inf' })} ${histogram.count}`);
      lines.push(`${name}_sum${renderLabels(histogram.labels)} ${histogram.sum}`);
      lines.push(`${name}_count${renderLabels(histogram.labels)} ${histogram.count}`);
    }

    return `${lines.join('\n')}\n`;
  }

  private incrementCounter(name: string, help: string, labels: Record<string, string>): void {
    const key = `${name}|${labelsKey(labels)}`;
    const existing = this.counters.get(key);
    if (existing) {
      existing.value += 1;
      return;
    }
    this.counters.set(key, { name, help, labels, value: 1 });
  }

  private observeHistogram(definition: HistogramDefinition, value: number, labels: Record<string, string>): void {
    const key = `${definition.name}|${labelsKey(labels)}`;
    let histogram = this.histograms.get(key);
    if (!histogram) {
      histogram = {
        labels,
        buckets: definition.buckets,
        counts: new Array(definition.buckets.length).fill(0) as number[],
        sum: 0,
        count: 0,
      };
      this.histograms.set(key, histogram);
    }

    histogram.count += 1;
    histogram.sum += value;
    definition.buckets.forEach((bucket, index) => {
      if (value <= bucket) histogram!.counts[index] += 1;
    });
  }
}

export const metricsService = new PrometheusMetricsService();
