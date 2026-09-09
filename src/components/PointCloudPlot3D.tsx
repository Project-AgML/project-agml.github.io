import { useEffect, useMemo, useRef, useState } from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import { usePlotlyChrome } from '../lib/plotlyChrome';
import { toTitleCase } from '../lib/datasets';
import styles from './DatasetMetadataModal.module.css';

export type PointCloudPoint = { x: number; y: number; z: number; label: number };
export type PointCloudCropSample = { crop: string; points: PointCloudPoint[] };

const DEFAULT_CAMERA_EYE = { x: 1.1, y: 1.1, z: 0.9 };
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
			marker: { size: 2, color: LABEL_COLORS[i % LABEL_COLORS.length], opacity: 0.75, line: { width: 0.3, color: markerRing } },
			hoverinfo: 'skip',
			hoverlabel,
		};
	});
}

// Fetches the precomputed multi-crop sample file. Each dataset's sample now holds
// one entry per crop (see scripts/generate_point_cloud_sample.py), instead of a
// single flat points array, so a dataset covering multiple species (e.g. Pheno4D's
// maize + tomato) can show either one via the crop selector below.
function usePointCloudSamples(sampleUrl: string) {
	const [samples, setSamples] = useState<PointCloudCropSample[] | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		fetch(sampleUrl)
			.then((res) => {
				if (!res.ok) throw new Error(`Failed to fetch point cloud sample: ${res.status}`);
				return res.json();
			})
			.then((data) => {
				if (!cancelled) setSamples(data.samples ?? []);
			})
			.catch((err) => {
				if (!cancelled) setError(err.message);
			});
		return () => {
			cancelled = true;
		};
	}, [sampleUrl]);

	return { samples, error };
}

export function PointCloudPlot3D({ sampleUrl }: { sampleUrl: string }) {
	const chrome = usePlotlyChrome();
	const { samples, error } = usePointCloudSamples(sampleUrl);
	const [activeCrop, setActiveCrop] = useState<string | null>(null);

	// Default to the first crop once samples load, mirrors EmbeddingScatter's
	// view state pattern (2D/3D toggle) but for crop selection instead.
	useEffect(() => {
		if (samples && samples.length > 0 && activeCrop == null) {
			setActiveCrop(samples[0].crop);
		}
	}, [samples, activeCrop]);

	const activeSample = useMemo(
		() => samples?.find((s) => s.crop === activeCrop) ?? samples?.[0] ?? null,
		[samples, activeCrop],
	);

	const hoverlabel = useMemo(
		() => ({
			bgcolor: chrome.tooltipBg,
			bordercolor: chrome.tooltipBorder,
			font: { color: chrome.tooltipText },
		}),
		[chrome],
	);
	const traces = useMemo(
		() => (activeSample ? buildTraces(activeSample.points, hoverlabel, chrome.markerRing) : []),
		[activeSample, hoverlabel, chrome.markerRing],
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
		<div>
			{/* Crop selector, only shown when there's more than one crop to choose from,
			    mirrors the embedToggle 2D/3D button pattern used elsewhere on this page. */}
			{samples && samples.length > 1 && (
				<div className={styles.embedToggle}>
					{samples.map((s) => (
						<button
							key={s.crop}
							type="button"
							className={`${styles.embedToggleButton} ${activeCrop === s.crop ? styles.embedToggleActive : ''}`}
							onClick={() => setActiveCrop(s.crop)}
						>
							{toTitleCase(s.crop)}
						</button>
					))}
				</div>
			)}

			<div className={styles.embedViewport}>
				<BrowserOnly fallback={<div className={styles.embedPlotFallback}>Loading 3D view…</div>}>
					{() => {
						if (!activeSample) return <div className={styles.embedPlotFallback}>Loading point cloud…</div>;
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
										aspectmode: 'data',
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
									// keyed by active crop so switching crops resets the camera to the
									// default framing instead of carrying over the previous crop's view
									uirevision: `point-cloud-3d-${activeSample.crop}`,
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
		</div>
	);
}

export default PointCloudPlot3D;