import { useMemo } from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import { usePlotlyChrome } from '../lib/plotlyChrome';
import type { DistributionEntry } from '../lib/datasets';
import styles from './GrowthLineChart.module.css';

export function DistributionBarChart({
	entries,
	color,
	xaxisTitle,
}: {
	entries: DistributionEntry[];
	color: 'primary' | 'teal';
	xaxisTitle: string;
}) {
	const chrome = usePlotlyChrome();
	const barColor = color === 'primary' ? chrome.accentPrimary : chrome.accentTeal;

	// Reversed so the highest count renders at the top of the horizontal bar chart (Plotly's
	// default category order for a horizontal bar runs bottom-to-top).
	const ordered = useMemo(() => [...entries].reverse(), [entries]);

	const trace = useMemo(
		() => ({
			type: 'bar',
			orientation: 'h',
			x: ordered.map((e) => e.count),
			y: ordered.map((e) => e.label),
			text: ordered.map((e) => e.count.toLocaleString()),
			textposition: 'outside',
			// The top bar's count label sits right at the plot's top edge — without this Plotly
			// clips it there instead of letting it draw into the margin.
			cliponaxis: false,
			textfont: { color: chrome.text, family: chrome.fontFamily, size: 11 },
			marker: { color: barColor },
			hovertemplate: '%{y}<br>%{x:,} datasets<extra></extra>',
			hoverlabel: {
				bgcolor: chrome.tooltipBg,
				bordercolor: chrome.tooltipBorder,
				font: { color: chrome.tooltipText },
			},
		}),
		[ordered, barColor, chrome],
	);

	return (
		<div className={styles.chartTall}>
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
								margin: { l: 128, r: 32, t: 12, b: 34 },
								paper_bgcolor: 'transparent',
								plot_bgcolor: 'transparent',
								xaxis: {
									title: { text: xaxisTitle, font: { color: chrome.text, family: chrome.fontFamily, size: 11 } },
									showgrid: true,
									gridcolor: chrome.grid,
									zeroline: false,
									tickfont: { color: chrome.text, family: chrome.fontFamily, size: 10.5 },
								},
								yaxis: {
									showgrid: false,
									linecolor: chrome.grid,
									tickfont: { color: chrome.text, family: chrome.fontFamily, size: 10.5 },
									automargin: true,
								},
								showlegend: false,
								hoverlabel: {
									bgcolor: chrome.tooltipBg,
									bordercolor: chrome.tooltipBorder,
									font: { color: chrome.tooltipText },
								},
								uirevision: 'distribution-chart',
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

export default DistributionBarChart;
