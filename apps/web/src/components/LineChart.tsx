import { LineChart as ELine } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import { useEffect, useRef, useState } from 'react';

echarts.use([ELine, GridComponent, TooltipComponent, SVGRenderer]);

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Re-render when the light/dark class on <html> changes. */
function useThemeKey(): string {
  const [key, setKey] = useState(() => document.documentElement.className);
  useEffect(() => {
    const obs = new MutationObserver(() => setKey(document.documentElement.className));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return key;
}

interface Props {
  /** [x label, value] pairs in order. */
  points: { x: string; y: number; tooltip: string }[];
  /** CSS variable for the series colour, e.g. "--accent". */
  colorVar: string;
  area?: boolean;
  height?: number;
  yFormat: (v: number) => string;
  ariaLabel: string;
}

/** Single-series line chart: 2px line, recessive grid, crosshair tooltip. One y-axis only. */
export function LineChart({ points, colorVar, area = false, height = 220, yFormat, ariaLabel }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const theme = useThemeKey();

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, undefined, { renderer: 'svg' });
    const color = cssVar(colorVar);
    const muted = cssVar('--muted');
    const border = cssVar('--border');
    chart.setOption({
      animation: false,
      grid: { left: 8, right: 16, top: 12, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: muted, type: 'dashed' } },
        backgroundColor: cssVar('--bg-card'),
        borderColor: border,
        textStyle: { color: cssVar('--text'), fontSize: 12 },
        formatter: (params: { dataIndex: number }[]) => points[params[0]!.dataIndex]?.tooltip ?? '',
      },
      xAxis: {
        type: 'category',
        data: points.map((p) => p.x),
        boundaryGap: false,
        axisLine: { lineStyle: { color: border } },
        axisTick: { show: false },
        axisLabel: { color: muted, fontSize: 11, hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        splitNumber: height < 160 ? 2 : 5,
        splitLine: { lineStyle: { color: border, opacity: 0.6 } },
        axisLabel: { color: muted, fontSize: 11, formatter: yFormat },
      },
      series: [
        {
          type: 'line',
          data: points.map((p) => p.y),
          showSymbol: points.length <= 40,
          symbolSize: 8,
          lineStyle: { width: 2, color },
          itemStyle: { color, borderColor: cssVar('--bg-card'), borderWidth: 2 },
          areaStyle: area ? { color, opacity: 0.12 } : undefined,
        },
      ],
    });
    const resize = new ResizeObserver(() => chart.resize());
    resize.observe(ref.current);
    return () => {
      resize.disconnect();
      chart.dispose();
    };
  }, [points, colorVar, area, yFormat, theme, height]);

  return <div ref={ref} role="img" aria-label={ariaLabel} style={{ height }} />;
}
