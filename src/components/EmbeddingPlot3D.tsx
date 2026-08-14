import { useMemo, useRef } from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import { toTitleCase } from '../lib/datasets';
import { usePlotlyChrome } from '../lib/plotlyChrome';
import type { EmbedPoint } from './DatasetMetadataModal';
import styles from './DatasetMetadataModal.module.css';

// Plotly's default eye distance (1.25 on each axis) leaves a lot of headroom around the
// cube — this pulls the camera in so it fills the panel. Shared with the reset handler below
// so "Reset view" restores exactly this framing, not Plotly's own (more zoomed-out) default.
const DEFAULT_CAMERA_EYE = { x: 0.85, y: 0.85, z: 0.85 };

// chrome.markerRing is a solid "rgb(r, g, b)" string (no alpha channel) — wrapping it as a
// translucent rgba() lets the 3D ring fade in gradually as points stack, instead of a solid
// stroke that saturates to a flat black smear after only a few overlaps.
function withAlpha(rgb: string, alpha: number): string {
	const match = /rgb\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)\s*\)/.exec(rgb);
	if (!match) return rgb;
	const [, r, g, b] = match;
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// plotly.js touches `window` at import time, which breaks Docusaurus's build-time SSR pass —
// the require() calls for it must stay inside a <BrowserOnly> children function so they're
// never evaluated outside the browser. This uses the full plotly.js-dist-min bundle (shared
// with EmbeddingPlot2D's scattergl trace) since 2D and 3D need different partial-bundle trace
// families (gl2d vs gl3d) that no single partial bundle covers together.
function buildTraces(
	points: EmbedPoint[],
	colorMap: Record<string, string>,
	hoverlabel: { bgcolor: string; bordercolor: string; font: { color: string } },
	markerRing: string,
) {
	return Object.keys(colorMap).map((group) => {
		const subset = points.filter((p) => p.cls === group);
		return {
			type: 'scatter3d',
			mode: 'markers',
			name: toTitleCase(group),
			x: subset.map((p) => p.x),
			y: subset.map((p) => p.y),
			z: subset.map((p) => p.z),
			// A full-opacity fill would flatten a dense cluster into one hard-edged silhouette —
			// dropping opacity lets overlapping points layer into a soft density gradient instead,
			// which reads as a point cloud rather than a sticker. The ring is real but very faint
			// (low alpha), so a couple of overlapping points still get a crisp edge without
			// hundreds of them compounding back into the solid dark smear this replaced.
			marker: { size: 4, color: colorMap[group], opacity: 0.72, line: { width: 0.5, color: withAlpha(markerRing, 0.22) } },
			text: subset.map((p) => `${toTitleCase(p.cls)} · ${p.split} · #${p.index}`),
			hovertemplate: '%{text}<extra></extra>',
			// Set per-trace, not just at the layout level — Plotly's hoverlabel.bgcolor
			// default is "auto" (derived from the trace/marker color), which otherwise wins.
			hoverlabel,
		};
	});
}

export function EmbeddingPlot3D({
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
	// Double-click (Plotly's usual reset gesture) resets 2D axis ranges but does *not* reset
	// the 3D camera, so an explicit control is the only reliable way to get back here.
	const plotlyRef = useRef<any>(null);
	const graphDivRef = useRef<HTMLElement | null>(null);
	const handleResetView = () => {
		if (!plotlyRef.current || !graphDivRef.current) return;
		plotlyRef.current.relayout(graphDivRef.current, {
			'scene.camera.eye': DEFAULT_CAMERA_EYE,
			'scene.xaxis.autorange': true,
			'scene.yaxis.autorange': true,
			'scene.zaxis.autorange': true,
		});
	};

	// Recessive hairline wireframe (one step off the panel surface) with numeric ticks —
	// gives the cloud a spatial reference frame instead of floating in a void. A *fresh*
	// object per axis, not a shared constant — see EmbeddingPlot2D for why (Plotly's internal
	// axis bookkeeping gets confused when multiple axes point at the literal same object).
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
			<BrowserOnly fallback={<div className={styles.embedPlotFallback}>Loading 3D view…</div>}>
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
								margin: { l: 20, r: 20, t: 15, b: 35 },
								paper_bgcolor: 'transparent',
								plot_bgcolor: 'transparent',
								scene: {
									aspectmode: 'cube',
									xaxis: makeAxis(),
									yaxis: makeAxis(),
									zaxis: makeAxis(),
									camera: { eye: DEFAULT_CAMERA_EYE },
								},
								showlegend: false,
								hoverlabel: {
									bgcolor: chrome.tooltipBg,
									bordercolor: chrome.tooltipBorder,
									font: { color: chrome.tooltipText },
								},
								// Keeps whatever camera orbit/zoom the user set across re-renders instead of
								// snapping back to the default eye position — see EmbeddingPlot2D for why.
								uirevision: 'embedding-3d',
							}}
							config={{ displayModeBar: false, responsive: true }}
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
				title="Drag to orbit, scroll to zoom · click to reset the view"
			>
				⟲ Reset view
			</button>
		</div>
	);
}

export default EmbeddingPlot3D;
