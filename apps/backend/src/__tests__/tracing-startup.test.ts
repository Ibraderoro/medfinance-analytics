const mockStart = jest.fn().mockResolvedValue(undefined);
const mockShutdown = jest.fn().mockResolvedValue(undefined);
const mockNodeSDK = jest.fn().mockImplementation(() => ({
  start: mockStart,
  shutdown: mockShutdown,
}));

const mockTraceExporter = jest.fn();
const mockGetNodeAutoInstrumentations = jest.fn(() => ['auto-instrumentation']);

jest.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: mockNodeSDK,
}));

jest.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: mockTraceExporter,
}));

jest.mock('@opentelemetry/auto-instrumentations-node', () => ({
  getNodeAutoInstrumentations: mockGetNodeAutoInstrumentations,
}));

import { startTracing, stopTracing } from '../observability/tracing';

describe('tracing startup lifecycle', () => {
  beforeEach(async () => {
    await stopTracing();
    mockStart.mockClear();
    mockShutdown.mockClear();
    mockNodeSDK.mockClear();
    mockTraceExporter.mockClear();
    mockGetNodeAutoInstrumentations.mockClear();
  });

  it('initializes SDK and exporter once when called repeatedly', async () => {
    await startTracing();
    await startTracing();

    expect(mockTraceExporter).toHaveBeenCalledTimes(1);
    expect(mockGetNodeAutoInstrumentations).toHaveBeenCalledTimes(1);
    expect(mockNodeSDK).toHaveBeenCalledTimes(1);
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it('shuts down SDK and allows clean restart', async () => {
    await startTracing();
    await stopTracing();
    await startTracing();

    expect(mockShutdown).toHaveBeenCalledTimes(1);
    expect(mockNodeSDK).toHaveBeenCalledTimes(2);
    expect(mockStart).toHaveBeenCalledTimes(2);
  });
});
