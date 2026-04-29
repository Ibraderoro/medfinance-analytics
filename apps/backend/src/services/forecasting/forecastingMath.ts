export type ForecastMetric = 'revenue' | 'expense' | 'net_income';

interface ExponentialSmoothingResult {
  fitted: number[];
  smoothed: number[];
  forecasts: number[];
}

export interface ConfidenceInterval {
  lower: number;
  upper: number;
}

export interface SeriesPoint {
  month: string;
  actual: number | null;
  forecast: number;
  confidence_interval: ConfidenceInterval;
}

export interface MetricForecastResult {
  metric: ForecastMetric;
  trend: 'increasing' | 'decreasing' | 'stable';
  confidenceLevel: number;
  series: SeriesPoint[];
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function getMonthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function addMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

export function formatMonth(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function exponentialSmoothing(series: number[], alpha: number): ExponentialSmoothingResult {
  const fitted: number[] = [];
  const smoothed: number[] = [];

  if (series.length === 0) {
    return { fitted, smoothed, forecasts: [] };
  }

  let prevSmoothed = series[0];
  smoothed.push(prevSmoothed);
  fitted.push(prevSmoothed);

  for (let i = 1; i < series.length; i += 1) {
    fitted.push(prevSmoothed);
    const nextSmoothed = alpha * series[i] + (1 - alpha) * prevSmoothed;
    smoothed.push(nextSmoothed);
    prevSmoothed = nextSmoothed;
  }

  return { fitted, smoothed, forecasts: [] };
}

function detectTrend(values: number[]): 'increasing' | 'decreasing' | 'stable' {
  if (values.length < 2) return 'stable';

  const lookback = Math.min(6, values.length);
  const window = values.slice(values.length - lookback);
  const first = window[0];
  const last = window[window.length - 1];
  const delta = last - first;
  const baseline = Math.max(Math.abs(first), 1);
  const pctMove = delta / baseline;

  if (pctMove > 0.03) return 'increasing';
  if (pctMove < -0.03) return 'decreasing';
  return 'stable';
}

export function buildForecastSeries(params: {
  metric: ForecastMetric;
  historicalValues: number[];
  historicalMonths: string[];
  forecastMonths: number;
  confidenceLevel?: number;
  alpha?: number;
}): MetricForecastResult {
  const {
    metric,
    historicalValues,
    historicalMonths,
    forecastMonths,
    confidenceLevel = 0.95,
    alpha = 0.35,
  } = params;

  if (historicalValues.length === 0 || historicalMonths.length === 0) {
    return {
      metric,
      trend: 'stable',
      confidenceLevel,
      series: [],
    };
  }

  const normalized = historicalValues.map((value) => (Number.isFinite(value) ? Math.max(0, value) : 0));
  const smoothing = exponentialSmoothing(normalized, alpha);

  const residuals = normalized
    .map((value, index) => value - smoothing.fitted[index])
    .slice(1);
  const sigma = stdDev(residuals);
  const zScore = 1.96; // 95% interval

  const historySeries: SeriesPoint[] = historicalMonths.map((month, index) => {
    const fittedValue = index === 0 ? normalized[index] : smoothing.fitted[index];
    return {
      month,
      actual: roundCurrency(normalized[index]),
      forecast: roundCurrency(fittedValue),
      confidence_interval: {
        lower: roundCurrency(Math.max(0, fittedValue - zScore * sigma)),
        upper: roundCurrency(Math.max(0, fittedValue + zScore * sigma)),
      },
    };
  });

  const lastMonthDate = new Date(`${historicalMonths[historicalMonths.length - 1]}T00:00:00.000Z`);
  const level = smoothing.smoothed[smoothing.smoothed.length - 1];

  const futureSeries: SeriesPoint[] = [];
  for (let step = 1; step <= forecastMonths; step += 1) {
    const month = formatMonth(addMonths(lastMonthDate, step));
    futureSeries.push({
      month,
      actual: null,
      forecast: roundCurrency(level),
      confidence_interval: {
        lower: roundCurrency(Math.max(0, level - zScore * sigma * Math.sqrt(step))),
        upper: roundCurrency(Math.max(0, level + zScore * sigma * Math.sqrt(step))),
      },
    });
  }

  return {
    metric,
    trend: detectTrend(smoothing.smoothed),
    confidenceLevel,
    series: [...historySeries, ...futureSeries],
  };
}
