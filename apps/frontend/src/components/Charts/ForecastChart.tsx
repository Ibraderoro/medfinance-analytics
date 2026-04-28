import { useEffect, useRef } from 'react';
import * as d3 from 'd3';

export interface ForecastDataPoint {
  month: string;
  actual?: number;
  forecast?: number;
}

interface ForecastChartProps {
  data: ForecastDataPoint[];
  width?: number;
  height?: number;
}

export function ForecastChart({ data, width = 600, height = 300 }: ForecastChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || data.length === 0) return;

    const margin = { top: 20, right: 100, bottom: 60, left: 60 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const g = svg
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3
      .scalePoint()
      .domain(data.map((d) => d.month))
      .range([0, innerWidth]);

    const allValues = data.flatMap((d) =>
      [d.actual, d.forecast].filter((v): v is number => v !== undefined),
    );

    const y = d3
      .scaleLinear()
      .domain([0, d3.max(allValues) ?? 0])
      .nice()
      .range([innerHeight, 0]);

    const lineActual = d3
      .line<ForecastDataPoint>()
      .defined((d) => d.actual !== undefined)
      .x((d) => x(d.month) ?? 0)
      .y((d) => y(d.actual ?? 0))
      .curve(d3.curveMonotoneX);

    const lineForecast = d3
      .line<ForecastDataPoint>()
      .defined((d) => d.forecast !== undefined)
      .x((d) => x(d.month) ?? 0)
      .y((d) => y(d.forecast ?? 0))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', '#1a56db')
      .attr('stroke-width', 2.5)
      .attr('d', lineActual);

    g.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', '#0694a2')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '6,4')
      .attr('d', lineForecast);

    const maxXTicks = 12;
    const step = Math.max(1, Math.ceil(data.length / maxXTicks));
    const xTickValues = data
      .map((d) => d.month)
      .filter((_, index) => index % step === 0);

    // Axes
    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x).tickValues(xTickValues).tickSizeOuter(0))
      .selectAll('text')
      .attr('font-size', '11px')
      .attr('text-anchor', 'end')
      .attr('transform', 'rotate(-35)')
      .attr('dx', '-0.5em')
      .attr('dy', '0.35em');

    g.append('g')
      .call(d3.axisLeft(y).tickFormat((v) => `$${d3.format(',.0f')(v as number)}`))
      .selectAll('text')
      .attr('font-size', '11px');

    // Legend
    const legend = svg
      .append('g')
      .attr('transform', `translate(${width - margin.right + 10},${margin.top})`);

    legend.append('line').attr('x1', 0).attr('x2', 20).attr('y1', 0).attr('y2', 0)
      .attr('stroke', '#1a56db').attr('stroke-width', 2.5);
    legend.append('text').attr('x', 25).attr('y', 4).text('Actual').attr('font-size', '11px');

    legend.append('line').attr('x1', 0).attr('x2', 20).attr('y1', 20).attr('y2', 20)
      .attr('stroke', '#0694a2').attr('stroke-width', 2).attr('stroke-dasharray', '6,4');
    legend.append('text').attr('x', 25).attr('y', 24).text('Forecast').attr('font-size', '11px');
  }, [data, width, height]);

  return <svg ref={svgRef} />;
}
