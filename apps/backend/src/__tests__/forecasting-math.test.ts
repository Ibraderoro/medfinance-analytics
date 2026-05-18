import { buildForecastSeries } from '../services/forecasting/forecastingMath';

describe('forecastingMath financial accuracy', () => {
  it('derives an increasing trend for high-volatility data with improving slope', () => {
    // Failure Mode: Volatile datasets can flatten trend detection and hide improving performance.
    const result = buildForecastSeries({
      metric: 'revenue',
      historicalValues: [100, 220, 140, 280, 210, 350],
      historicalMonths: ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01'],
      forecastMonths: 3,
      alpha: 0.4,
    });

    expect(result.trend).toBe('increasing');
    expect(result.series).toHaveLength(9);
    expect(result.series[8].confidence_interval.upper).toBeGreaterThan(result.series[8].confidence_interval.lower);
  });

  it('keeps margin-relevant forecast bounded at zero when revenue history is zero', () => {
    // Failure Mode: Zero-revenue months can create negative fitted values and impossible negative margins.
    const result = buildForecastSeries({
      metric: 'revenue',
      historicalValues: [0, 0, 0, 0],
      historicalMonths: ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01'],
      forecastMonths: 2,
    });

    for (const point of result.series) {
      expect(point.forecast).toBe(0);
      expect(point.confidence_interval.lower).toBe(0);
      expect(point.confidence_interval.upper).toBe(0);
    }
  });

  it('normalizes negative growth and negative actuals to avoid invalid financial outputs', () => {
    // Failure Mode: Data import glitches can inject negative revenue and corrupt projections.
    const result = buildForecastSeries({
      metric: 'revenue',
      historicalValues: [300, 250, 200, -50],
      historicalMonths: ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01'],
      forecastMonths: 1,
      alpha: 0.5,
    });

    expect(result.trend).toBe('decreasing');
    expect(result.series[3].actual).toBe(0);
    expect(result.series[4].forecast).toBeGreaterThanOrEqual(0);
  });


  it('remains finite when historical data includes extreme outliers', () => {
    // Failure Mode: Extraordinary spikes/drops can produce NaN/Infinity and break dashboards.
    const result = buildForecastSeries({
      metric: 'revenue',
      historicalValues: [120, 130, 125, 1400, 115, 118],
      historicalMonths: ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01'],
      forecastMonths: 3,
      alpha: 0.45,
    });

    for (const point of result.series) {
      expect(Number.isFinite(point.forecast)).toBe(true);
      expect(Number.isFinite(point.confidence_interval.lower)).toBe(true);
      expect(Number.isFinite(point.confidence_interval.upper)).toBe(true);
    }
  });

  it('handles missing months in history without crashing interpolation/forecast generation', () => {
    // Failure Mode: Incomplete accounting periods can skip months and destabilize the time-series pipeline.
    const result = buildForecastSeries({
      metric: 'revenue',
      historicalValues: [90, 92, 95, 99],
      historicalMonths: ['2026-01-01', '2026-03-01', '2026-06-01', '2026-07-01'],
      forecastMonths: 2,
      alpha: 0.35,
    });

    expect(result.series).toHaveLength(6);
    expect(result.series[4].month).toBe('2026-08-01');
    expect(result.series[5].month).toBe('2026-09-01');
    expect(result.series.every((point) => Number.isFinite(point.forecast))).toBe(true);
  });

  it('sanitizes invalid numeric inputs and zero-revenue histories into safe zero outputs', () => {
    // Failure Mode: Null-like ingest artifacts (NaN) plus zero baselines should not propagate invalid numbers.
    const result = buildForecastSeries({
      metric: 'revenue',
      historicalValues: [0, Number.NaN, 0, 0],
      historicalMonths: ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01'],
      forecastMonths: 1,
      alpha: 0.3,
    });

    for (const point of result.series) {
      expect(point.forecast).toBe(0);
      expect(point.confidence_interval.lower).toBe(0);
      expect(point.confidence_interval.upper).toBe(0);
    }
  });

  it('produces expense forecasts that can be used for margin calculations', () => {
    // Failure Mode: Expense smoothing can drift and break net-margin denominator assumptions.
    const expenseResult = buildForecastSeries({
      metric: 'expense',
      historicalValues: [40, 45, 47, 43, 44],
      historicalMonths: ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01'],
      forecastMonths: 1,
    });

    const revenueResult = buildForecastSeries({
      metric: 'revenue',
      historicalValues: [100, 102, 104, 105, 106],
      historicalMonths: ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01'],
      forecastMonths: 1,
    });

    const revenueForecast = revenueResult.series[5].forecast;
    const expenseForecast = expenseResult.series[5].forecast;
    const projectedMarginPct = Number((((revenueForecast - expenseForecast) / revenueForecast) * 100).toFixed(2));

    expect(expenseForecast).toBeGreaterThan(0);
    expect(projectedMarginPct).toBeGreaterThan(40);
    expect(projectedMarginPct).toBeLessThan(80);
  });
});


describe('Edge Case Resilience', () => {
  it('keeps forecasts finite under an extreme month-over-month spike', () => {
    const result = buildForecastSeries({
      metric: 'revenue',
      historicalValues: [100, 1000000, 120, 130, 140],
      historicalMonths: ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01'],
      forecastMonths: 2,
      alpha: 0.35,
    });

    for (const point of result.series) {
      expect(Number.isFinite(point.forecast)).toBe(true);
      expect(Number.isFinite(point.confidence_interval.lower)).toBe(true);
      expect(Number.isFinite(point.confidence_interval.upper)).toBe(true);
    }
  });

  it('handles gapped historical data containing null-like and zero intermediate values', () => {
    const result = buildForecastSeries({
      metric: 'revenue',
      historicalValues: [250, null as unknown as number, 0, 300, 0, 325],
      historicalMonths: ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01'],
      forecastMonths: 2,
      alpha: 0.4,
    });

    expect(result.series).toHaveLength(8);
    expect(result.series.every((point) => Number.isFinite(point.forecast))).toBe(true);
    expect(result.series.every((point) => Number.isFinite(point.confidence_interval.lower))).toBe(true);
    expect(result.series.every((point) => Number.isFinite(point.confidence_interval.upper))).toBe(true);
  });
});

describe('Trend edge coverage', () => {
  it('returns an empty stable forecast for empty history', () => {
    const result = buildForecastSeries({
      metric: 'net_income',
      historicalValues: [],
      historicalMonths: [],
      forecastMonths: 3,
      confidenceLevel: 0.9,
    });

    expect(result).toEqual({
      metric: 'net_income',
      trend: 'stable',
      confidenceLevel: 0.9,
      series: [],
    });
  });

  it('classifies small movements as stable', () => {
    const result = buildForecastSeries({
      metric: 'revenue',
      historicalValues: [100, 101, 102],
      historicalMonths: ['2026-01-01', '2026-02-01', '2026-03-01'],
      forecastMonths: 1,
      alpha: 0.2,
    });

    expect(result.trend).toBe('stable');
  });
});
