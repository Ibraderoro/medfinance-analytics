import { addMonths, buildForecastSeries, formatMonth, getMonthStart } from '../services/forecasting/forecastingMath';

describe('forecasting math', () => {
  it('builds forecast series with future months', () => {
    const result = buildForecastSeries({ metric: 'revenue', historicalValues: [100, 120, 130], historicalMonths: ['2026-01-01', '2026-02-01', '2026-03-01'], forecastMonths: 2 });
    expect(result.series).toHaveLength(5);
    expect(result.series[0].actual).toBe(100);
    expect(result.series[4].actual).toBeNull();
  });

  it('handles empty history', () => {
    const result = buildForecastSeries({ metric: 'expense', historicalValues: [], historicalMonths: [], forecastMonths: 3 });
    expect(result.series).toEqual([]);
  });

  it('date helpers are deterministic', () => {
    const d = getMonthStart(new Date('2026-04-15T12:00:00.000Z'));
    expect(formatMonth(addMonths(d, 1))).toBe('2026-05-01');
  });
});
