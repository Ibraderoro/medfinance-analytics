import { useEffect, useRef } from 'react';
import * as d3 from 'd3';

export interface ComplianceDataPoint {
  label: string;
  value: number;
  color: string;
}

interface ComplianceChartProps {
  data: ComplianceDataPoint[];
  width?: number;
  height?: number;
}

export function ComplianceChart({ data, width = 320, height = 300 }: ComplianceChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || data.length === 0) return;

    const radius = Math.min(width, height) / 2 - 20;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const g = svg
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${width / 2},${height / 2})`);

    const pie = d3.pie<ComplianceDataPoint>().value((d) => d.value);
    const arc = d3.arc<d3.PieArcDatum<ComplianceDataPoint>>()
      .innerRadius(radius * 0.55)
      .outerRadius(radius);

    const arcs = g
      .selectAll('.arc')
      .data(pie(data))
      .join('g')
      .attr('class', 'arc');

    arcs
      .append('path')
      .attr('d', arc)
      .attr('fill', (d) => d.data.color)
      .attr('stroke', '#fff')
      .attr('stroke-width', 2);

    // Labels
    arcs
      .append('text')
      .attr('transform', (d) => `translate(${arc.centroid(d)})`)
      .attr('text-anchor', 'middle')
      .attr('font-size', '12px')
      .attr('fill', '#fff')
      .attr('font-weight', '600')
      .text((d) => `${d.data.value}`);

    // Legend below chart
    const legend = svg
      .append('g')
      .attr('transform', `translate(${width / 2 - (data.length * 80) / 2}, ${height - 20})`);

    data.forEach((d, i) => {
      const legendItem = legend.append('g').attr('transform', `translate(${i * 100}, 0)`);
      legendItem.append('rect').attr('width', 12).attr('height', 12).attr('fill', d.color).attr('rx', 3);
      legendItem.append('text').attr('x', 16).attr('y', 11).attr('font-size', '11px').text(d.label);
    });
  }, [data, width, height]);

  return <svg ref={svgRef} />;
}
