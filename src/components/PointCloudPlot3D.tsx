import { useEffect, useMemo, useRef, useState } from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import { usePlotlyChrome } from '../lib/plotlyChrome';
import styles from './DatasetMetadataModal.module.css';

// Mirrors EmbedPoint's shape (see DatasetMetadataModal), but for raw point cloud
// coordinates rather than a dimensionality-reduced embedding. "label" is the
// dataset's own mask value (e.g. Pheno4D's 0-3), not a semantic class name — we
// don't have human-readable names for these, so the legend shows raw values.
export type PointCloudPoint = { x: number; y: number; z: number; label: number };

// Default camera eye, same framing convention as EmbeddingPlot3D so both plots
// feel consistent, though point clouds are usually denser/more elongated than
// an embedding cluster so this may need per-dataset tuning later.
const DEFAULT_CAMERA_EYE = { x: 1.1, y: 1.1, z: 0.9 };

// Fixed small palette since mask values are usually a handful of small integers
// (0-3, 0-5), not open-ended classes like embeddings' cls field.
const LABEL_COLORS = ['#4CAF50', '#FF9800', '#2196F3', '#E91E63', '#9C27B0', '#00BCD4'];

function buildTraces(
	points: PointCloudPoint[],
	hoverlabel: { bgcolor: string; bordercolor: string; font: { color: string } },
	markerRing: string,
) {
	const labels = Array.from(new Set(points.map((p) => p.label))).sort((a, b) => a - b);
	return labels.map((label, i) => {
		const subset = points.filter((p) => p.label === label);
		return {
			type: 'scatter3d',
			mode: 'markers',
			name: `mask value ${label}`,
			x: subset.map((p) => p.x),
			y: subset.map((p) => p.y),
			z: subset.map((p) => p.z),
			// Smaller/more opaque than EmbeddingPlot3D's points — point clouds run into
			// the thousands per scan (vs. embeddings' hundreds), so a lighter touch per
			// point keeps dense regions from fusing into a solid blob.
			marker: { size: 2, color: LABEL_COLORS[i % LABEL_COLORS.length], opacity: 0.75, line: { width: 0.3, color: markerRing } },
			// No per-point hover text (unlike EmbeddingPlot3D) — at this point count,
			// per-point hover adds cost without much value; the legend already
			// distinguishes mask values by color.
			hoverinfo: 'skip',
			hoverlabel,
		};
	});
}

// Fetches the precomputed, subsampled point cloud JSON for one dataset. Point
// clouds are far too large (multi-GB Parquet) to fetch live client-side, so a
// small normalized sample is generated at dataset-prep time and stored as a
// static asset (see scripts/generate_point_cloud_sample.py), the same pattern
// as examples_image_url for the static preview image.
function usePointCloudSample(sampleUrl: string) {
	const [points, setPoints] = useState<PointCloudPoint[] | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		fetch(sampleUrl)
			.then((res) => {
				if (!res.ok) throw new Error(`Failed to fetch point cloud sample: ${res.status}`);
				return res.json();
			})
			.then((data) => {
				if (!cancelled) setPoints(data.points);
			})
			.catch((err) => {
				if (!cancelled) setError(err.message);
			});
		return () => {
			cancelled = true;
		};
	}, [sampleUrl]);

	return { points, error };
}

export function PointCloudPlot3D({ sampleUrl }: { sampleUrl: string }) {
	const chrome = usePlotlyChrome();
	const { points, error } = usePointCloudSample(sampleUrl);

	const hoverlabel = useMemo(
		() => ({
			bgcolor: chrome.tooltipBg,
			bordercolor: chrome.tooltipBorder,
			font: { color: chrome.tooltipText },
		}),
		[chrome],
	);
	const traces = useMemo(
		() => (points ? buildTraces(points, hoverlabel, chrome.markerRing) : []),
		[points, hoverlabel, chrome.markerRing],
	);

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

	const makeAxis = () => ({
		showgrid: true,
		gridcolor: chrome.grid,
		zeroline: false,
		showticklabels: true,
		linecolor: chrome.grid,
		tickfont: { color: chrome.text, family: chrome.fontFamily, size: 10 },
	});

	if (error) {
		return <div className={styles.embedPlotFallback}>Point cloud preview unavailable.</div>;
	}

	return (
		<div className={styles.embedViewport}>
			<BrowserOnly fallback={<div className={styles.embedPlotFallback}>Loading 3D view…</div>}>
				{() => {
					if (!points) return <div className={styles.embedPlotFallback}>Loading point cloud…</div>;
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
									aspectmode: 'data', // preserve real point cloud proportions, unlike embeddings' 'cube'
									xaxis: makeAxis(),
									yaxis: makeAxis(),
									zaxis: makeAxis(),
									camera: { eye: DEFAULT_CAMERA_EYE },
								},
								showlegend: true,
								legend: { font: { color: chrome.text, family: chrome.fontFamily, size: 10 } },
								hoverlabel: {
									bgcolor: chrome.tooltipBg,
									bordercolor: chrome.tooltipBorder,
									font: { color: chrome.tooltipText },
								},
								uirevision: 'point-cloud-3d',
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

export default PointCloudPlot3D;