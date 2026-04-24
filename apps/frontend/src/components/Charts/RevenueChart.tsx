import { useEffect, useRef } from 'react';
import * as d3 from 'd3';

export interface RevenueDataPoint {
  month: string;
  total: number;
}

interface RevenueChartProps {
  data: RevenueDataPoint[];
  width?: number;
  height?: number;
}

export function RevenueChart({ data, width = 600, height = 300 }: RevenueChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || data.length === 0) return;

    const margin = { top: 20, right: 30, bottom: 40, left: 60 };
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
      .scaleBand()
      .domain(data.map((d) => d.month))
      .range([0, innerWidth])
      .padding(0.2);

    const y = d3
      .scaleLinear()
      .domain([0, d3.max(data, (d) => d.total) ?? 0])
      .nice()
      .range([innerHeight, 0]);

    // Gridlines
    g.append('g')
      .attr('class', 'gridlines')
      .call(
        d3.axisLeft(y)
          .tickSize(-innerWidth)
          .tickFormat(() => ''),
      )
      .selectAll('line')
      .attr('stroke', '#e5e7eb')
      .attr('stroke-dasharray', '4,4');

    g.select('.gridlines .domain').remove();

    // Bars
    g.selectAll('.bar')
      .data(data)
      .join('rect')
      .attr('class', 'bar')
      .attr('x', (d) => x(d.month) ?? 0)
      .attr('y', (d) => y(d.total))
      .attr('width', x.bandwidth())
      .attr('height', (d) => innerHeight - y(d.total))
      .attr('fill', '#1a56db')
      .attr('rx', 3);

    // Axes
    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x))
      .selectAll('text')
      .attr('font-size', '11px');

    g.append('g')
      .call(
        d3.axisLeft(y).tickFormat((v) =>
          `$${d3.format(',.0f')(v as number)}`,
        ),
      )
      .selectAll('text')
      .attr('font-size', '11px');
  }, [data, width, height]);

  return <svg ref={svgRef} />;
}
