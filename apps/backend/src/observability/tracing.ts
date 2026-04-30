import { logger } from '../utils/logger';

let sdk: { start: () => Promise<void>; shutdown: () => Promise<void> } | null = null;

export async function startTracing(): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Resource } = require('@opentelemetry/resources');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');

    const traceEndpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const traceHeaders = process.env.OTEL_EXPORTER_OTLP_HEADERS;

    sdk = new NodeSDK({
      resource: new Resource({ [SemanticResourceAttributes.SERVICE_NAME]: 'medfinance-backend' }),
      traceExporter: new OTLPTraceExporter({
        url: traceEndpoint,
        headers: traceHeaders
          ? Object.fromEntries(
              traceHeaders
                .split(',')
                .map((header: string) => header.trim())
                .filter(Boolean)
                .map((header: string) => {
                  const [key, ...rest] = header.split('=');
                  return [key.trim(), rest.join('=').trim()];
                }),
            )
          : undefined,
      }),
      instrumentations: [getNodeAutoInstrumentations()],
    });

    if (sdk) {
      await sdk.start();
    }
  } catch (error) {
    logger.warn('OpenTelemetry not started', { message: (error as Error).message });
  }
}

export async function stopTracing(): Promise<void> {
  if (!sdk) return;
  await sdk.shutdown();
  sdk = null;
}
