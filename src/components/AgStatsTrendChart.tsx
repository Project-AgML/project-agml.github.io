import { useMemo } from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import { useColorMode } from '@docusaurus/theme-common';
import { usePlotlyChrome } from '../lib/plotlyChrome';
import styles from './AgStatsTrendChart.module.css';

// Fixed categorical order, validated for colorblind separation against the site's light and dark
// chart surfaces. Each series keeps its slot for as long as it is selected (see the page), so
// removing one series never repaints the others.
const SERIES_COLORS = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#6250d6'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9'],
};

export const MAX_TREND_SERIES = SERIES_COLORS.light.length;

export interface TrendSeries {
  key: string;
  label: string;
  slot: number;
  points: [number, number][];
}

export function AgStatsTrendChart({ series, yaxisTitle }: { series: TrendSeries[]; yaxisTitle: string }) {
  const chrome = usePlotlyChrome();
  const { colorMode } = useColorMode();
  const palette = SERIES_COLORS[colorMode === 'dark' ? 'dark' : 'light'];
  // Up to four series also get a name label at the end of their line, so identity never rests
  // on color alone. More than that and the end labels would collide, so the legend carries it.
  const directLabels = series.length <= 4;

  const traces = useMemo(
    () =>
      series.map((s) => {
        const color = palette[s.slot % palette.length];
        return {
          type: 'scatter',
          mode: 'lines',
          name: s.label,
          x: s.points.map((p) => p[0]),
          y: s.points.map((p) => p[1]),
          line: { color, width: 2 },
          connectgaps: false,
          hovertemplate: `${s.label}: %{y:,.2f}<extra></extra>`,
        };
      }),
    [series, palette],
  );

  // The x range is pinned to the data. Plotly would otherwise widen it to fit the end labels.
  const xRange = useMemo(() => {
    const years = series.flatMap((s) => s.points.map((p) => p[0]));
    return years.length ? [Math.min(...years), Math.max(...years)] : undefined;
  }, [series]);

  const annotations = useMemo(() => {
    if (!directLabels) return [];
    const ends = series
      .filter((s) => s.points.length > 0)
      .map((s) => ({ s, last: s.points[s.points.length - 1], y: s.points[s.points.length - 1][1] }));
    // Push end labels apart vertically so lines that finish close together stay readable. The gap
    // is a share of the y range, about one text line at the chart's height.
    const values = series.flatMap((s) => s.points.map((p) => p[1]));
    const gap = (Math.max(...values, 0) || 1) * 0.06;
    const sorted = [...ends].sort((a, b) => a.y - b.y);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].y - sorted[i - 1].y < gap) sorted[i].y = sorted[i - 1].y + gap;
    }
    return ends.map(({ s, last, y }) => {
        return {
          x: last[0],
          y,
          xref: 'x' as const,
          yref: 'y' as const,
          text: s.label,
          showarrow: false,
          xanchor: 'left' as const,
          xshift: 6,
          font: { color: chrome.tooltipText, family: chrome.fontFamily, size: 10.5 },
        };
      });
  }, [series, directLabels, chrome]);

  if (series.length === 0) {
    return <div className={styles.empty}>Select at least one series to plot.</div>;
  }

  return (
    <div className={styles.chart}>
      <BrowserOnly fallback={<div className={styles.empty}>Loading chart…</div>}>
        {() => {
          const Plotly = require('plotly.js-dist-min');
          const createPlotlyComponent = require('react-plotly.js/factory').default;
          const Plot = createPlotlyComponent(Plotly);
          return (
            <Plot
              data={traces}
              layout={{
                autosize: true,
                margin: { l: 56, r: directLabels ? 110 : 20, t: 16, b: 40 },
                paper_bgcolor: 'transparent',
                plot_bgcolor: 'transparent',
                xaxis: {
                  showgrid: false,
                  linecolor: chrome.grid,
                  range: xRange,
                  autorange: xRange ? false : true,
                  tickformat: 'd',
                  tickfont: { color: chrome.text, family: chrome.fontFamily, size: 10.5 },
                },
                yaxis: {
                  title: { text: yaxisTitle, font: { color: chrome.text, family: chrome.fontFamily, size: 11 } },
                  showgrid: true,
                  gridcolor: chrome.grid,
                  zeroline: false,
                  rangemode: 'tozero',
                  tickfont: { color: chrome.text, family: chrome.fontFamily, size: 10.5 },
                },
                annotations,
                showlegend: true,
                legend: {
                  orientation: 'h',
                  x: 0,
                  y: -0.16,
                  font: { color: chrome.text, family: chrome.fontFamily, size: 11 },
                },
                hovermode: 'x unified',
                hoverlabel: {
                  bgcolor: chrome.tooltipBg,
                  bordercolor: chrome.tooltipBorder,
                  font: { color: chrome.tooltipText, family: chrome.fontFamily },
                },
              }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: '100%', height: '100%' }}
              useResizeHandler
            />
          );
        }}
      </BrowserOnly>
    </div>
  );
}
