import { useMemo } from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import { usePlotlyChrome } from '../lib/plotlyChrome';
import styles from './GrowthLineChart.module.css';

export interface GrowthPoint {
	period: string;
	value: number;
	// ISO date, used only to thin out point-value labels to one per calendar month (see
	// `labeledIndices` below) — weekly points would otherwise print an overlapping label at every
	// point. Points without a date (e.g. yearly pre-2026 snapshots) are always labeled.
	date?: string;
}

export interface GrowthAnnotation {
	// Draws a dashed reference line immediately before this period (between it and the prior
	// point) when `position` is 'before', or centered on it when 'at'.
	atPeriod: string;
	position: 'before' | 'at';
	label: string;
}

// Compact axis/label formatting: 5_014_234 -> "5.01M", 157_741 -> "158K". Values under 1,000
// print as-is — the chart never needs sub-thousand compaction.
function formatCompact(value: number): string {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`;
	if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
	return String(value);
}

// usePlotlyChrome resolves colors to "rgb(r, g, b)" (see plotlyChrome.ts) specifically so Plotly
// never has to parse a CSS color function itself — stay consistent and derive the translucent
// area fill the same way rather than handing Plotly a color-mix()/rgba() literal.
function withAlpha(rgbColor: string, alpha: number): string {
	const match = /rgb\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(rgbColor);
	if (!match) return rgbColor;
	const [, r, g, b] = match;
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function GrowthLineChart({
	points,
	annotations,
	color,
	yaxisTitle,
}: {
	points: GrowthPoint[];
	annotations?: GrowthAnnotation[];
	color: 'primary' | 'teal';
	yaxisTitle: string;
}) {
	const chrome = usePlotlyChrome();
	const lineColor = color === 'primary' ? chrome.accentPrimary : chrome.accentTeal;

	// Which points get a printed value label: always the first, the last, and any point an
	// annotation lands on; otherwise at most one per calendar month (the first point encountered
	// in it) — dense weekly data would otherwise print an overlapping label at every point.
	const labeledIndices = useMemo(() => {
		const annotated = new Set(annotations?.map((a) => a.atPeriod) ?? []);
		const shown = new Set<number>();
		let lastMonthKey: string | null = null;
		points.forEach((point, index) => {
			const monthKey = point.date?.slice(0, 7) ?? point.period;
			const isEdge = index === 0 || index === points.length - 1;
			const isNewMonth = monthKey !== lastMonthKey;
			if (isEdge || isNewMonth || annotated.has(point.period)) {
				shown.add(index);
				lastMonthKey = monthKey;
			}
		});
		return shown;
	}, [points, annotations]);

	const trace = useMemo(
		() => ({
			type: 'scatter',
			mode: 'lines+markers+text',
			x: points.map((p) => p.period),
			y: points.map((p) => p.value),
			text: points.map((p, i) => (labeledIndices.has(i) ? formatCompact(p.value) : '')),
			textposition: 'top center',
			textfont: { color: chrome.text, family: chrome.fontFamily, size: 11 },
			// Without this, Plotly clips the first/last point's value label at the plot-area edge
			// the moment it overhangs into the margin (which "top center" text on an edge point
			// always does slightly) — let labels draw into the margin instead of getting cut off.
			cliponaxis: false,
			line: { color: lineColor, width: 2, shape: 'linear' },
			marker: { size: 6, color: lineColor, line: { width: 1, color: chrome.markerRing } },
			fill: 'tozeroy',
			fillcolor: withAlpha(lineColor, 0.12),
			hovertemplate: '%{x}<br>%{y:,.0f}<extra></extra>',
			hoverlabel: {
				bgcolor: chrome.tooltipBg,
				bordercolor: chrome.tooltipBorder,
				font: { color: chrome.tooltipText },
			},
		}),
		[points, lineColor, chrome, labeledIndices],
	);

	const shapes = useMemo(() => {
		if (!annotations?.length) return [];
		return annotations.map((ann) => {
			const idx = points.findIndex((p) => p.period === ann.atPeriod);
			if (idx === -1) return null;
			// A dashed line drawn 'before' the point sits at the midpoint between it and the prior
			// point (marks a transition), while 'at' sits directly on the point (marks an event).
			const x =
				ann.position === 'before' && idx > 0
					? (idx - 0.5)
					: idx;
			return {
				type: 'line' as const,
				xref: 'x' as const,
				yref: 'paper' as const,
				x0: x,
				x1: x,
				y0: 0,
				y1: 1,
				// Full text contrast (not the recessive grid color) and a touch wider — this line
				// marks a specific event/transition and should read clearly against the chart, not
				// blend in with the axis grid.
				line: { color: chrome.tooltipText, width: 1.5, dash: 'dash' },
			};
		}).filter((s): s is NonNullable<typeof s> => s != null);
	}, [annotations, points, chrome.grid]);

	const plotlyAnnotations = useMemo(() => {
		if (!annotations?.length) return [];
		return annotations.map((ann) => {
			const idx = points.findIndex((p) => p.period === ann.atPeriod);
			if (idx === -1) return null;
			const x = ann.position === 'before' && idx > 0 ? idx - 0.5 : idx;
			return {
				x,
				// Above the top of the plot area (paper y > 1), in the margin — not y: 1, which sits
				// right at the plot's top edge and collides with the line/point labels whenever the
				// data is near its peak there.
				y: 1,
				xref: 'x' as const,
				yref: 'paper' as const,
				text: ann.label,
				showarrow: false,
				xanchor: 'left' as const,
				yanchor: 'bottom' as const,
				yshift: 6,
				xshift: 6,
				font: { color: chrome.text, family: chrome.fontFamily, size: 10.5 },
				align: 'left' as const,
			};
		}).filter((a): a is NonNullable<typeof a> => a != null);
	}, [annotations, points, chrome.text, chrome.fontFamily]);

	return (
		<div className={styles.chart}>
			<BrowserOnly fallback={<div className={styles.fallback}>Loading chart…</div>}>
				{() => {
					const Plotly = require('plotly.js-dist-min');
					const createPlotlyComponent = require('react-plotly.js/factory').default;
					const Plot = createPlotlyComponent(Plotly);
					return (
						<Plot
							data={[trace]}
							layout={{
								autosize: true,
								margin: { l: 48, r: 32, t: 40, b: 34 },
								paper_bgcolor: 'transparent',
								plot_bgcolor: 'transparent',
								xaxis: {
									type: 'category',
									showgrid: false,
									linecolor: chrome.grid,
									tickfont: { color: chrome.text, family: chrome.fontFamily, size: 10.5 },
								},
								yaxis: {
									title: { text: yaxisTitle, font: { color: chrome.text, family: chrome.fontFamily, size: 11 } },
									showgrid: true,
									gridcolor: chrome.grid,
									zeroline: false,
									rangemode: 'tozero',
									tickfont: { color: chrome.text, family: chrome.fontFamily, size: 10.5 },
									tickformat: '.2s',
								},
								shapes,
								annotations: plotlyAnnotations,
								showlegend: false,
								hovermode: 'x unified',
								hoverlabel: {
									bgcolor: chrome.tooltipBg,
									bordercolor: chrome.tooltipBorder,
									font: { color: chrome.tooltipText },
								},
								uirevision: 'growth-chart',
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

export default GrowthLineChart;
