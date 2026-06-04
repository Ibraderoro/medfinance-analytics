import { AsyncLocalStorage } from 'async_hooks';
import { randomBytes } from 'crypto';
import { Request, Response } from 'express';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';

const TRACEPARENT_VERSION = '00';
const SAMPLED_FLAG = '01';
const NOT_SAMPLED_FLAG = '00';
const TRACE_ID_BYTES = 16;
const SPAN_ID_BYTES = 8;
const TRACEPARENT_PATTERN = /^([\da-f]{2})-([\da-f]{32})-([\da-f]{16})-([\da-f]{2})$/i;

export type TraceContext = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  sampled: boolean;
};

const traceContextStorage = new AsyncLocalStorage<TraceContext>();
let tracingSdk: NodeSDK | undefined;

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

function isAllZero(value: string): boolean {
  return /^0+$/.test(value);
}

function parseTraceparent(header: string | undefined): TraceContext | undefined {
  if (!header) return undefined;
  const match = TRACEPARENT_PATTERN.exec(header.trim());
  if (!match) return undefined;

  const [, , traceId, parentSpanId, flags] = match;
  if (isAllZero(traceId) || isAllZero(parentSpanId)) return undefined;

  return {
    traceId: traceId.toLowerCase(),
    spanId: randomHex(SPAN_ID_BYTES),
    parentSpanId: parentSpanId.toLowerCase(),
    sampled: (Number.parseInt(flags, 16) & 1) === 1,
  };
}

function parseSamplingRatio(): number {
  const raw = process.env.OTEL_TRACES_SAMPLER_ARG ?? process.env.TRACE_SAMPLE_RATE ?? '0.10';
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return 0.1;
  return Math.min(Math.max(parsed, 0), 1);
}

function shouldSample(): boolean {
  return Math.random() < parseSamplingRatio();
}

export function getCurrentTraceContext(): TraceContext | undefined {
  return traceContextStorage.getStore();
}

export function getTraceLogFields(): Record<string, string | boolean> {
  const context = getCurrentTraceContext();
  if (!context) return {};
  return {
    trace_id: context.traceId,
    span_id: context.spanId,
    trace_sampled: context.sampled,
  };
}

export function getTraceparent(context = getCurrentTraceContext()): string | undefined {
  if (!context) return undefined;
  return `${TRACEPARENT_VERSION}-${context.traceId}-${context.spanId}-${context.sampled ? SAMPLED_FLAG : NOT_SAMPLED_FLAG}`;
}

export function runWithTraceContext<T>(req: Request, res: Response, callback: () => T): T {
  const incoming = parseTraceparent(req.header('traceparent'));
  const context: TraceContext = incoming ?? {
    traceId: randomHex(TRACE_ID_BYTES),
    spanId: randomHex(SPAN_ID_BYTES),
    sampled: shouldSample(),
  };

  req.traceId = context.traceId;
  req.spanId = context.spanId;
  req.traceSampled = context.sampled;
  const traceparent = getTraceparent(context);
  if (traceparent) res.setHeader('traceparent', traceparent);
  res.setHeader('x-trace-id', context.traceId);

  return traceContextStorage.run(context, callback);
}

export async function startTracing(): Promise<void> {
  if (tracingSdk) return;
  tracingSdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [getNodeAutoInstrumentations()],
  });
  await tracingSdk.start();
}

export async function stopTracing(): Promise<void> {
  if (!tracingSdk) return;
  const sdk = tracingSdk;
  tracingSdk = undefined;
  await sdk.shutdown();
}
