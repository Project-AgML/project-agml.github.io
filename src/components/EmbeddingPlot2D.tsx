import { useMemo, useRef } from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import { toTitleCase } from '../lib/datasets';
import { usePlotlyChrome } from '../lib/plotlyChrome';
import type { EmbedPoint } from './DatasetMetadataModal';
import styles from './DatasetMetadataModal.module.css';

// scattergl (WebGL) instead of the SVG scatter trace — SVG puts one DOM node per point and
// bogs down well before real dataset sizes. See EmbeddingPlot3D for the SSR/bundle notes;
// both views share the same plotly.js-dist-min instance.
function buildTraces(
	points: EmbedPoint[],
	colorMap: Record<string, string>,
	hoverlabel: { bgcolor: string; bordercolor: string; font: { color: string } },
	markerRing: string,
) {
	return Object.keys(colorMap).map((group) => {
		const subset = points.filter((p) => p.cls === group);
		return {
			type: 'scattergl',
			mode: 'markers',
			name: toTitleCase(group),
			x: subset.map((p) => p.x),
			y: subset.map((p) => p.y),
			// A thin ring in the panel's own surface color separates overlapping points instead
			// of them just fusing into a blob at the edges.
			marker: { size: 7, color: colorMap[group], opacity: 0.85, line: { width: 1, color: markerRing } },
			text: subset.map((p) => `${toTitleCase(p.cls)} · ${p.split} · #${p.index}`),
			hovertemplate: '%{text}<extra></extra>',
			// Set per-trace, not just at the layout level — Plotly's hoverlabel.bgcolor
			// default is "auto" (derived from the trace/marker color), which otherwise wins.
			hoverlabel,
		};
	});
}

export function EmbeddingPlot2D({
	points,
	colorMap,
}: {
	points: EmbedPoint[];
	colorMap: Record<string, string>;
}) {
	const chrome = usePlotlyChrome();
	const hoverlabel = useMemo(
		() => ({
			bgcolor: chrome.tooltipBg,
			bordercolor: chrome.tooltipBorder,
			font: { color: chrome.tooltipText },
		}),
		[chrome],
	);
	const traces = useMemo(
		() => buildTraces(points, colorMap, hoverlabel, chrome.markerRing),
		[points, colorMap, hoverlabel, chrome.markerRing],
	);

	// Captured once the plot mounts, so the "Reset view" button can relayout it directly.
	const plotlyRef = useRef<any>(null);
	const graphDivRef = useRef<HTMLElement | null>(null);
	const handleResetView = () => {
		if (!plotlyRef.current || !graphDivRef.current) return;
		plotlyRef.current.relayout(graphDivRef.current, { 'xaxis.autorange': true, 'yaxis.autorange': true });
	};

	// Recessive hairline grid with numeric ticks — gives the cloud a spatial reference frame
	// instead of floating in a void. A *fresh* object per axis — Plotly's internal axis
	// bookkeeping got confused when xaxis/yaxis pointed at the literal same object (identical
	// autoranged x/y spans regardless of actual data, and scroll-zoom anchoring at the wrong
	// point), so this is a factory, not a shared constant.
	const makeAxis = () => ({
		showgrid: true,
		gridcolor: chrome.grid,
		zeroline: false,
		showticklabels: true,
		linecolor: chrome.grid,
		tickfont: { color: chrome.text, family: chrome.fontFamily, size: 10 },
	});

	return (
		<div className={styles.embedViewport}>
			<BrowserOnly fallback={<div className={styles.embedPlotFallback}>Loading 2D view…</div>}>
				{() => {
					const Plotly = require('plotly.js-dist-min');
					plotlyRef.current = Plotly;
					const createPlotlyComponent = require('react-plotly.js/factory').default;
					const Plot = createPlotlyComponent(Plotly);
					return (
						<Plot
							data={traces}
							onInitialized={(_figure: unknown, graphDiv: HTMLElement) => {
								graphDivRef.current = graphDiv;
							}}
							onUpdate={(_figure: unknown, graphDiv: HTMLElement) => {
								graphDivRef.current = graphDiv;
							}}
							layout={{
								autosize: true,
								margin: { l: 35, r: 15, t: 15, b: 30 },
								paper_bgcolor: 'transparent',
								plot_bgcolor: 'transparent',
								// x/y autorange independently (no scaleanchor) so the plot fills the panel's
								// actual aspect ratio instead of leaving gutters to preserve a 1:1 scale.
								xaxis: makeAxis(),
								yaxis: makeAxis(),
								showlegend: false,
								hoverlabel: {
									bgcolor: chrome.tooltipBg,
									bordercolor: chrome.tooltipBorder,
									font: { color: chrome.tooltipText },
								},
								// Drag disabled outright — Plotly's default 'zoom' draws a rubber-band select
								// box, and 'pan' has a rendering-pipeline quirk where the SVG grid/tick layer
								// only catches up to the WebGL point layer at drag-end instead of tracking it
								// live, which reads as the grid "jumping" mid-drag. Scroll-zoom (below) has
								// neither problem since each wheel tick is a discrete, fully-committed relayout.
								dragmode: false,
								// A constant uirevision tells Plotly to keep whatever zoom/pan the user set
								// across re-renders. Without it, any re-render (e.g. a theme toggle recomputing
								// chrome colors) passes a "fresh" layout with only autorange requested, and
								// Plotly.react() reads that as "reset the view" — the zoom snapping back you saw.
								uirevision: 'embedding-2d',
							}}
							// Plotly's cartesian plots default scrollZoom to false (only mapbox/geo get it
							// for free) — this adds the scroll-wheel zoom people expect from a scatter plot.
							config={{ displayModeBar: false, responsive: true, scrollZoom: true }}
							style={{ width: '100%', height: '100%' }}
							useResizeHandler
						/>
					);
				}}
			</BrowserOnly>
			<button
				type="button"
				className={styles.embedResetButton}
				onClick={handleResetView}
				title="Scroll to zoom · click to reset the view"
			>
				⟲ Reset view
			</button>
		</div>
	);
}

export default EmbeddingPlot2D;
