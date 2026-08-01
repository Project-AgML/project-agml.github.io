import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { Dataset } from '../lib/datasets';
import { formatDisplayLocation, toTitleCase } from '../lib/datasets';
import { toDisplayLabel } from '../lib/labelOverrides';
import { useBenchmark, type BenchmarkData, type EmbedPoint as RawEmbedPoint } from '../lib/benchmarks';
import { METRIC_CATEGORY_LABELS, useDatasetPerformance } from '../lib/performance';
import type { MetricCategory, PerformanceEntry } from '../lib/performance';
import styles from './DatasetMetadataModal.module.css';

function formatImageCount(count: number | null) {
	if (count == null) return 'Unknown';
	if (count >= 1000) {
		const scaled = (count / 1000).toFixed(1);
		const trimmed = scaled.endsWith('.0') ? scaled.slice(0, -2) : scaled;
		return `${trimmed}k`;
	}
	return count.toLocaleString();
}

function formatValue(value: string | string[] | null | undefined) {
	if (value == null) return 'Unknown';
	if (Array.isArray(value)) return value.length ? value.map(toTitleCase).join(', ') : 'Unknown';
	return toTitleCase(value);
	return value;
}

function formatArray(value: number[] | null) {
	if (value == null || value.length === 0) return 'Unknown';
	return `[${value.map((entry) => entry.toFixed(3)).join(', ')}]`;
}

function formatBytesDecimal(bytes: number | null | undefined) {
	if (bytes == null) return 'Unknown';
	if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown';

	const units = ['B', 'kB', 'MB', 'GB', 'TB'];
	let value = bytes;
	let unitIndex = 0;

	while (value >= 1000 && unitIndex < units.length - 1) {
		value /= 1000;
		unitIndex += 1;
	}

	const formatted = value >= 100 ? Math.round(value).toString() : value.toFixed(1);
	const trimmed = formatted.endsWith('.0') ? formatted.slice(0, -2) : formatted;
	return `${trimmed} ${units[unitIndex]}`;
}

const EMPTY_ENTRIES: PerformanceEntry[] = [];

function hasExampleImage(url: string | null): url is string {
	return Boolean(url);
}

function formatResultType(entry: { variant: 'zero-shot' | 'fine-tuned' | null; optimized: boolean }) {
	const base = entry.variant === 'fine-tuned' ? 'Fine-tuned' : entry.variant === 'zero-shot' ? 'Zero-shot' : '—';
	if (base === '—') return base;
	return entry.optimized ? `${base} (optimized)` : base;
}

function taskBadgeClass(task: string | null): string {
	if (!task) return styles.badgeOther;
	if (task.includes('classif')) return styles.badgeClassification;
	if (task.includes('detect')) return styles.badgeDetection;
	if (task.includes('segment')) return styles.badgeSegmentation;
	return styles.badgeOther;
}

function formatTunedKey(key: string) {
	return key === 'fine-tuned' ? 'Fine-tuned' : 'Zero-shot';
}

function formatOptimizedKey(key: string) {
	return key === 'optimized' ? 'Optimized' : 'Not optimized';
}

function parseFilterNumber(value: string): number | null {
	if (!value.trim()) return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function formatTimePerImage(value: number | null) {
	if (value == null || !Number.isFinite(value)) return '—';
	return `${value.toFixed(3)} s/img`;
}

function formatMetricScore(entry: { metrics: { key: string; label: string; value: number }[]; score: number | null }) {
	if (entry.metrics.length > 0) {
		return entry.metrics.map((metric) => `${metric.label}: ${metric.value.toFixed(3)}`).join(' · ');
	}
	return entry.score != null ? entry.score.toLocaleString() : '—';
}

function formatLoaderInstructions(dataset: Dataset) {
	if (dataset.source === 'huggingface') {
		if(dataset.dataset_type === 'vlm') {
			return {
				title: 'Load from Hugging Face',
				code: `from datasets import load_dataset\nloader = load_dataset("Project-AgML/${dataset.name}")`,
			};
		}
		return {
			title: 'Load from Hugging Face',
			code: `from agml.data.hf_loader import HuggingFaceDataLoader\nloader = HuggingFaceDataLoader("Project-AgML/${dataset.name}")`,
		};
	}

	return {
		title: 'Load with AgML',
		code: `import agml\nloader = agml.data.AgMLDataLoader("${dataset.name}")`,
	};
}

function StatTile({ label, value }: { label: string; value: string }) {
	return (
		<div className={styles.statTile}>
			<p className={styles.statTileLabel}>{label}</p>
			<p className={styles.statTileValue}>{value}</p>
		</div>
	);
}

type MetricBar = { label: string; value: string; pct: number; positive?: boolean };
type MetricStat = { label: string; value: string };
type MetricCardVM =
	| { kind: 'bars'; title: string; badge?: string; bars: MetricBar[]; footerStats?: MetricStat[] }
	| { kind: 'signed'; title: string; badge?: string; bars: MetricBar[]; footerStats?: MetricStat[] }
	| { kind: 'stats'; title: string; badge?: string; stats: MetricStat[] }
	| { kind: 'skipped'; title: string; message: string };

function buildMetricCards(benchmark: BenchmarkData): MetricCardVM[] {
	const m = benchmark.metrics;
	const cards: MetricCardVM[] = [];

	if (m.class_imbalance) {
		const d = m.class_imbalance;
		const max = Math.max(...Object.values(d.counts));
		cards.push({
			kind: 'bars',
			title: 'Class Imbalance',
			badge: `${d.total_train_examples} train examples`,
			bars: Object.entries(d.counts).map(([label, value]) => ({ label: toTitleCase(label), value: value.toLocaleString(), pct: (value / max) * 100 })),
			footerStats: [
				{ label: 'Imbalance ratio', value: d.imbalance_ratio.toFixed(2) },
				{ label: 'Norm. entropy', value: d.normalized_entropy.toFixed(2) },
				{ label: 'Most frequent', value: toTitleCase(d.most_frequent_class) },
				{ label: 'Least frequent', value: toTitleCase(d.least_frequent_class) },
			],
		});
	}

	if (m.exact_duplicate) {
		const d = m.exact_duplicate;
		cards.push({
			kind: 'stats',
			title: 'Exact Duplicates',
			badge: `${d.total_images} images`,
			stats: [
				{ label: 'Duplicate count', value: String(d.exact_duplicate_count) },
				{ label: 'Duplicate rate', value: `${(d.exact_duplicate_rate * 100).toFixed(1)}%` },
				{ label: 'Groups', value: String(d.duplicate_groups) },
				{ label: 'Cross-split', value: String(d.cross_split_duplicates) },
			],
		});
	}

	if (m.near_duplicate) {
		const d = m.near_duplicate;
		cards.push({
			kind: 'stats',
			title: 'Near Duplicates',
			badge: d.embed_model,
			stats: [
				{ label: 'Near-dup count', value: String(d.near_duplicate_count) },
				{ label: 'Near-dup rate', value: `${(d.near_duplicate_rate * 100).toFixed(1)}%` },
				{ label: 'Groups', value: String(d.near_duplicate_groups) },
				{ label: 'Cross-split', value: String(d.cross_split_near_duplicates) },
				{ label: 'Threshold', value: String(d.threshold) },
				{ label: 'Index type', value: d.faiss_index_type },
			],
		});
	}

	if (m.resolution_consistency) {
		const d = m.resolution_consistency;
		cards.push({
			kind: 'stats',
			title: 'Resolution Consistency',
			badge: `${d.total_images} images`,
			stats: [
				{ label: 'Width (mean)', value: `${d.width.mean}px` },
				{ label: 'Height (mean±std)', value: `${d.height.mean.toFixed(0)}±${d.height.std.toFixed(1)}` },
				{ label: 'Aspect ratio', value: `${d.aspect_ratio.mean.toFixed(2)} (${d.aspect_ratio.min.toFixed(2)}–${d.aspect_ratio.max.toFixed(2)})` },
				{ label: 'Area CV', value: d.area_cv.toFixed(3) },
				{ label: 'Color mode', value: Object.keys(d.mode_distribution).join(', ') },
			],
		});
	}

	if (m.feature_separability) {
		const d = m.feature_separability;
		cards.push({
			kind: 'signed',
			title: 'Feature Separability',
			badge: d.embed_model,
			bars: Object.entries(d.per_class_silhouette).map(([label, value]) => ({
				label: toTitleCase(label),
				value: value.toFixed(2),
				pct: Math.abs(value) * 50,
				positive: value >= 0,
			})),
			footerStats: [
				{ label: 'Silhouette', value: `${d.silhouette_score.toFixed(2)} — ${d.silhouette_interpretation}` },
				{ label: 'Davies-Bouldin', value: `${d.davies_bouldin_index.toFixed(2)} — ${d.davies_bouldin_interpretation}` },
			],
		});
	}

	if (m.intra_class_diversity) {
		const d = m.intra_class_diversity;
		const max = Math.max(...Object.values(d.per_class_diversity));
		cards.push({
			kind: 'bars',
			title: 'Intra-class Diversity',
			badge: d.embed_model,
			bars: Object.entries(d.per_class_diversity).map(([label, value]) => ({ label: toTitleCase(label), value: value.toFixed(2), pct: (value / max) * 100 })),
			footerStats: [
				{ label: 'Mean diversity', value: d.mean_diversity.toFixed(2) },
				{ label: 'Min class', value: toTitleCase(d.min_diversity_class) },
				{ label: 'Max class', value: toTitleCase(d.max_diversity_class) },
			],
		});
	}

	if (m.metadata_coverage?.skipped) {
		cards.push({ kind: 'skipped', title: 'Metadata Coverage', message: m.metadata_coverage.reason || 'Skipped for this run.' });
	}

	return cards;
}

function MetricCard({ card }: { card: MetricCardVM }) {
	const badge = card.kind !== 'skipped' ? card.badge : undefined;
	return (
		<div className={styles.metricCard}>
			<div className={styles.metricCardHeader}>
				<h4 className={styles.metricCardTitle}>{card.title}</h4>
				{badge && <span className={styles.metricCardBadge}>{badge}</span>}
			</div>

			{card.kind === 'skipped' && <p className={styles.metricSkipped}>Skipped — {card.message}</p>}

			{(card.kind === 'bars' || card.kind === 'signed') && (
				<div className={styles.metricBars}>
					{card.bars.map((bar) => (
						<div key={bar.label} className={styles.metricBarRow}>
							<span className={styles.metricBarLabel}>{bar.label}</span>
							{card.kind === 'signed' ? (
								<div className={styles.metricSignedTrack}>
									<div className={styles.metricSignedMidline} />
									<div
										className={`${styles.metricSignedFill} ${bar.positive ? styles.metricSignedPositive : styles.metricSignedNegative}`}
										style={{
											width: `${bar.pct}%`,
											left: bar.positive ? '50%' : undefined,
											right: bar.positive ? undefined : '50%',
										}}
									/>
								</div>
							) : (
								<div className={styles.metricBarTrack}>
									<div className={styles.metricBarFill} style={{ width: `${Math.max(2, bar.pct)}%` }} />
								</div>
							)}
							<span className={styles.metricBarValue}>{bar.value}</span>
						</div>
					))}
				</div>
			)}

			{card.kind === 'stats' && (
				<div className={styles.statTileGrid}>
					{card.stats.map((stat) => (
						<StatTile key={stat.label} label={stat.label} value={stat.value} />
					))}
				</div>
			)}

			{(card.kind === 'bars' || card.kind === 'signed') && card.footerStats && card.footerStats.length > 0 && (
				<div className={styles.metricFooterStats}>
					{card.footerStats.map((stat) => (
						<StatTile key={stat.label} label={stat.label} value={stat.value} />
					))}
				</div>
			)}
		</div>
	);
}

const EMBED_CLASS_COLORS = ['var(--ifm-color-primary)', 'oklch(0.66 0.15 60)', 'oklch(0.58 0.14 250)', 'oklch(0.62 0.16 340)'];
const AXIS_TICKS = [-1, -0.5, 0, 0.5, 1];
const EMBED_CLUSTER_CENTERS: [number, number, number][] = [
	[-0.6, 0.5, 0.3],
	[0.55, 0.55, -0.4],
	[-0.5, -0.55, -0.2],
	[0.6, -0.5, 0.45],
];

function mulberry32(seed: number) {
	return function random() {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

type EmbedPoint = { id: string; cls: string; color: string; x: number; y: number; z: number };

function colorForClass(cls: string, classOrder: string[]): string {
	const index = classOrder.indexOf(cls);
	return EMBED_CLASS_COLORS[(index < 0 ? 0 : index) % EMBED_CLASS_COLORS.length];
}

function embedPointsFromReal(embeddings: RawEmbedPoint[], classOrder: string[]): EmbedPoint[] {
	return embeddings.map((p, i) => ({
		id: `${p.class}-${i}`,
		cls: p.class,
		color: colorForClass(p.class, classOrder),
		x: p.x,
		y: p.y,
		z: p.z,
	}));
}

function buildEmbeddingPoints(benchmark: BenchmarkData): EmbedPoint[] {
	const counts = benchmark.metrics.class_imbalance?.counts ?? {};
	const sep = benchmark.metrics.feature_separability?.per_class_silhouette ?? {};
	const classes = Object.keys(counts);
	const rand = mulberry32(42);
	const points: EmbedPoint[] = [];
	classes.forEach((cls, i) => {
		const center = EMBED_CLUSTER_CENTERS[i % EMBED_CLUSTER_CENTERS.length];
		const color = EMBED_CLASS_COLORS[i % EMBED_CLASS_COLORS.length];
		const sil = sep[cls] ?? 0.3;
		const spread = 0.22 + Math.max(0, 0.65 - sil) * 0.55;
		const n = Math.max(6, Math.round((counts[cls] || 30) / 8));
		for (let k = 0; k < n; k += 1) {
			const jitter = () => (((rand() + rand() + rand()) - 1.5) / 1.5) * spread;
			points.push({ id: `${cls}-${k}`, cls, color, x: center[0] + jitter(), y: center[1] + jitter(), z: center[2] + jitter() });
		}
	});
	return points;
}

function projectEmbeddingPoints(points: EmbedPoint[], theta: number, phi: number, mode: '2d' | '3d') {
	const focal = 2.6;
	const projected = points.map((p) => {
		if (mode === '2d') return { ...p, sx: p.x, sy: p.y, depth: 0, scale: 1 };
		const cosT = Math.cos(theta);
		const sinT = Math.sin(theta);
		const x1 = p.x * cosT + p.z * sinT;
		const z1 = -p.x * sinT + p.z * cosT;
		const cosP = Math.cos(phi);
		const sinP = Math.sin(phi);
		const y2 = p.y * cosP - z1 * sinP;
		const z2 = p.y * sinP + z1 * cosP;
		const scale = focal / (focal + z2);
		return { ...p, sx: x1 * scale, sy: y2 * scale, depth: z2, scale };
	});
	if (mode !== '2d') projected.sort((a, b) => a.depth - b.depth);
	return projected;
}

function EmbeddingScatter({ benchmark, embeddings }: { benchmark: BenchmarkData; embeddings: RawEmbedPoint[] | null }) {
	const [view, setView] = useState<'2d' | '3d'>('2d');
	const [theta, setTheta] = useState(0.6);
	const [phi, setPhi] = useState(0.32);
	const draggingRef = useRef(false);
	const lastPointerRef = useRef<{ x: number; y: number } | null>(null);

	const hasRealEmbeddings = Boolean(embeddings && embeddings.length > 0);
	const points = useMemo(() => {
		if (embeddings && embeddings.length > 0) {
			const classOrder = Object.keys(benchmark.metrics.class_imbalance?.counts ?? {});
			return embedPointsFromReal(embeddings, classOrder);
		}
		return buildEmbeddingPoints(benchmark);
	}, [embeddings, benchmark]);

	useEffect(() => {
		const timer = setInterval(() => {
			if (draggingRef.current) return;
			setTheta((t) => t + 0.006);
		}, 40);
		return () => clearInterval(timer);
	}, []);

	useEffect(() => {
		const onMove = (event: MouseEvent) => {
			if (!lastPointerRef.current) return;
			const dx = event.clientX - lastPointerRef.current.x;
			const dy = event.clientY - lastPointerRef.current.y;
			lastPointerRef.current = { x: event.clientX, y: event.clientY };
			setTheta((t) => t + dx * 0.008);
			setPhi((p) => Math.max(-1.2, Math.min(1.2, p - dy * 0.008)));
		};
		const onUp = () => {
			draggingRef.current = false;
			lastPointerRef.current = null;
		};
		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
		return () => {
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
		};
	}, []);

	const onDown = (event: ReactMouseEvent) => {
		draggingRef.current = true;
		lastPointerRef.current = { x: event.clientX, y: event.clientY };
	};

	const projected = useMemo(() => projectEmbeddingPoints(points, theta, phi, view), [points, theta, phi, view]);
	const legend = useMemo(() => {
		const seen = new Map<string, string>();
		points.forEach((p) => seen.set(p.cls, p.color));
		return Array.from(seen.entries());
	}, [points]);

	const embedModel = benchmark.metrics.feature_separability?.embed_model ?? 'dinov2-base';

	return (
		<section className={styles.section}>
			<div className={styles.embedHeader}>
				<div>
					<h3 className={styles.sectionTitle}>Embedding Space — UMAP</h3>
					<p className={styles.embedSubtitle}>{embedModel}</p>
				</div>
				<div className={styles.embedToggle}>
					<button
						type="button"
						className={`${styles.embedToggleButton} ${view === '2d' ? styles.embedToggleActive : ''}`}
						onClick={() => setView('2d')}
					>
						2D
					</button>
					<button
						type="button"
						className={`${styles.embedToggleButton} ${view === '3d' ? styles.embedToggleActive : ''}`}
						onClick={() => setView('3d')}
					>
						3D
					</button>
				</div>
			</div>

			<div className={styles.embedViewport} onMouseDown={onDown} style={{ cursor: view === '2d' ? 'default' : 'grab' }}>
				{AXIS_TICKS.map((value) => (
					<span key={`x-${value}`} className={styles.embedAxisTickX} style={{ left: `${50 + value * 38}%` }}>
						{value}
					</span>
				))}
				{AXIS_TICKS.map((value) => (
					<span key={`y-${value}`} className={styles.embedAxisTickY} style={{ top: `${50 - value * 38}%` }}>
						{value}
					</span>
				))}
				{projected.map((p) => (
					<div
						key={p.id}
						title={toTitleCase(p.cls)}
						style={{
							position: 'absolute',
							left: `${50 + p.sx * 38}%`,
							top: `${50 - p.sy * 38}%`,
							width: `${view === '2d' ? 8 : Math.max(4, 7 * p.scale)}px`,
							height: `${view === '2d' ? 8 : Math.max(4, 7 * p.scale)}px`,
							borderRadius: '50%',
							background: p.color,
							opacity: view === '2d' ? 0.85 : Math.max(0.35, Math.min(1, 0.55 + p.scale * 0.4)),
							transform: 'translate(-50%,-50%)',
							boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
							pointerEvents: 'none',
						}}
					/>
				))}
				{view === '3d' && <p className={styles.embedDragHint}>drag to orbit</p>}
			</div>

			<div className={styles.embedLegend}>
				{legend.map(([cls, color]) => (
					<span key={cls} className={styles.embedLegendItem}>
						<span className={styles.embedLegendDot} style={{ background: color }} />
						{toTitleCase(cls)}
					</span>
				))}
			</div>
			<p className={styles.embedNote}>
				{hasRealEmbeddings
					? 'projected from embeddings.json'
					: `no embeddings.json found for this dataset · showing a seeded demo scatter around class clusters`}
			</p>
		</section>
	);
}

function formatRunDate(runId: string): string {
	const match = /^(\d{4})(\d{2})(\d{2})/.exec(runId);
	if (!match) return runId;
	const [, year, month, day] = match;
	return `${month}/${day}/${year}`;
}

function BenchmarkView({ benchmark, embeddings }: { benchmark: BenchmarkData; embeddings: RawEmbedPoint[] | null }) {
	const cards = useMemo(() => buildMetricCards(benchmark), [benchmark]);
	return (
		<div>
			<p className={styles.benchmarkRunNote}>Last benchmarking check run: {formatRunDate(benchmark.run_id)}</p>
			<hr className={styles.benchmarkDivider} />
			<div className={styles.metricCardGrid}>
				{cards.map((card) => (
					<MetricCard key={card.title} card={card} />
				))}
			</div>
			<EmbeddingScatter benchmark={benchmark} embeddings={embeddings} />
		</div>
	);
}

function InlineFilterGroup({
	label,
	options,
	selected,
	onToggle,
	formatOption = (value: string) => value,
}: {
	label: string;
	options: string[];
	selected: string[];
	onToggle: (value: string) => void;
	formatOption?: (value: string) => string;
}) {
	return (
		<div className={styles.filterGroup}>
			<p className={styles.filterGroupLabel}>{label}</p>
			<div className={styles.filterGroupOptions}>
				{options.map((option) => (
					<label key={option} className={styles.filterCheckboxRow}>
						<input
							type="checkbox"
							className={styles.checkbox}
							checked={selected.includes(option)}
							onChange={() => onToggle(option)}
						/>
						<span>{formatOption(option)}</span>
					</label>
				))}
			</div>
		</div>
	);
}

export function DatasetMetadataModal({
	dataset,
	open,
	onClose,
}: {
	dataset: Dataset | null;
	open: boolean;
	onClose: () => void;
}) {
	useEffect(() => {
		if (!open) return;

		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onClose();
		};

		window.addEventListener('keydown', onKeyDown);
		return () => {
			document.body.style.overflow = previousOverflow;
			window.removeEventListener('keydown', onKeyDown);
		};
	}, [open, onClose]);

	const datasetPerformance = useDatasetPerformance(open ? (dataset?.name ?? null) : null);
	const { data: benchmark, embeddings } = useBenchmark(open ? (dataset?.name ?? null) : null);
	const [showBenchmarks, setShowBenchmarks] = useState(false);
	useEffect(() => setShowBenchmarks(false), [dataset?.name, open]);

	const [metricTypeFilter, setMetricTypeFilter] = useState<string[]>([]);
	const [tunedFilter, setTunedFilter] = useState<string[]>([]);
	const [optimizedFilter, setOptimizedFilter] = useState<string[]>([]);
	const [platformFilter, setPlatformFilter] = useState<string[]>([]);
	const [trainingTimeMax, setTrainingTimeMax] = useState('');
	const [trainingSizeMin, setTrainingSizeMin] = useState('');

	const allEntries = datasetPerformance.data?.entries ?? EMPTY_ENTRIES;

	const { metricTypeOptions, tunedOptions, optimizedOptions, platformOptions } = useMemo(() => {
		const metricTypes = new Set<MetricCategory>();
		const tuned = new Set<string>();
		const optimized = new Set<string>();
		const platforms = new Set<string>();
		for (const entry of allEntries) {
			entry.metricCategories.forEach((category) => metricTypes.add(category));
			if (entry.variant) tuned.add(entry.variant);
			optimized.add(entry.optimized ? 'optimized' : 'not-optimized');
			if (entry.platform) platforms.add(entry.platform);
		}
		return {
			metricTypeOptions: Array.from(metricTypes),
			tunedOptions: Array.from(tuned).sort(),
			optimizedOptions: Array.from(optimized).sort(),
			platformOptions: Array.from(platforms).sort(),
		};
	}, [allEntries]);

	const toggleFilter = (setter: (updater: (current: string[]) => string[]) => void, value: string) => {
		setter((current) => (current.includes(value) ? current.filter((v) => v !== value) : [...current, value]));
	};

	const filteredEntries = useMemo(() => {
		const timeMax = parseFilterNumber(trainingTimeMax);
		const sizeMin = parseFilterNumber(trainingSizeMin);

		return allEntries.filter((entry: PerformanceEntry) => {
			if (metricTypeFilter.length && !entry.metricCategories.some((category) => metricTypeFilter.includes(category))) {
				return false;
			}
			if (tunedFilter.length && !(entry.variant && tunedFilter.includes(entry.variant))) return false;
			if (optimizedFilter.length && !optimizedFilter.includes(entry.optimized ? 'optimized' : 'not-optimized')) return false;
			if (platformFilter.length && !(entry.platform && platformFilter.includes(entry.platform))) return false;
			if (timeMax != null && (entry.trainTimePerImage == null || entry.trainTimePerImage > timeMax)) return false;
			if (sizeMin != null && (entry.trainPercentage == null || entry.trainPercentage < sizeMin)) return false;
			return true;
		});
	}, [allEntries, metricTypeFilter, tunedFilter, optimizedFilter, platformFilter, trainingTimeMax, trainingSizeMin]);

	const hasActiveLeaderboardFilters =
		metricTypeFilter.length > 0 ||
		tunedFilter.length > 0 ||
		optimizedFilter.length > 0 ||
		platformFilter.length > 0 ||
		trainingTimeMax !== '' ||
		trainingSizeMin !== '';

	const clearLeaderboardFilters = () => {
		setMetricTypeFilter([]);
		setTunedFilter([]);
		setOptimizedFilter([]);
		setPlatformFilter([]);
		setTrainingTimeMax('');
		setTrainingSizeMin('');
	};

	const [cropsExpanded, setCropsExpanded] = useState(false);
	const [classesExpanded, setClassesExpanded] = useState(false);
	const [copied, setCopied] = useState(false);

	const [expandedRowKeys, setExpandedRowKeys] = useState<Set<string>>(new Set());
	const toggleExpandedRow = (key: string) => {
		setExpandedRowKeys((current) => {
			const next = new Set(current);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	};
	useEffect(() => setExpandedRowKeys(new Set()), [filteredEntries]);

	if (!open || dataset == null) return null;

	const isVlm = dataset.dataset_type === 'vlm';

	const metadataRows = [
		['Location', formatDisplayLocation(dataset.location)],
		['Sensor modality', dataset.sensor_modality == null || dataset.sensor_modality === '' ? 'Unknown' : toDisplayLabel(dataset.sensor_modality)],
		['Platform', formatValue(dataset.platform)],
		...(isVlm
			? ([
					['Conversation format', formatValue(dataset.conversation_format)],
					['Num of samples', formatImageCount(dataset.num_rows)],
				] as const)
			: ([['Number of images', formatImageCount(dataset.num_images)]] as const)),
		['Size', formatBytesDecimal(dataset.zip_size_bytes)],
		...(dataset.augmented_num_images != null
			? ([['Augmented images', formatImageCount(dataset.augmented_num_images)]] as const)
			: []),
		...(dataset.augmented_zip_size_bytes != null
			? ([['Augmented size', formatBytesDecimal(dataset.augmented_zip_size_bytes)]] as const)
			: []),
	] as [string, string][];
	const loader = formatLoaderInstructions(dataset);
	const cropList = dataset.crop_types ?? [];
	const classList = dataset.classes ? dataset.classes.split(', ').filter(Boolean) : [];

	return (
		<div className={styles.backdrop} role="presentation" onClick={onClose}>
			<div
				className={styles.modal}
				role="dialog"
				aria-modal="true"
				aria-labelledby="dataset-metadata-title"
				onClick={(event) => event.stopPropagation()}
			>
				<div className={styles.header}>
					<div>
						<h2 id="dataset-metadata-title" className={styles.title}>
							{dataset.name}
						</h2>
						<div className={styles.headerBadges}>
							{dataset.machine_learning_task && (
								<span className={`${styles.taskBadge} ${taskBadgeClass(dataset.machine_learning_task)}`}>
									{formatValue(dataset.machine_learning_task)}
								</span>
							)}
							{dataset.agricultural_task && <span className={styles.tag}>{formatValue(dataset.agricultural_task)}</span>}
							{dataset.real_or_synthetic && <span className={styles.tag}>{formatValue(dataset.real_or_synthetic)}</span>}
						</div>
					</div>
					<div className={styles.headerActions}>
						{benchmark && (
							<button type="button" className={styles.benchmarkToggle} onClick={() => setShowBenchmarks((value) => !value)}>
								{showBenchmarks ? '← Back to Details' : '📊 View Benchmarks'}
							</button>
						)}
						<button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close dataset details">
							×
						</button>
					</div>
				</div>

				<div className={`${styles.flipper} ${showBenchmarks ? styles.flipperFlipped : ''}`}>
				<div
					className={`${styles.face} ${showBenchmarks ? styles.faceHidden : ''}`}
					style={{ visibility: showBenchmarks ? 'hidden' : 'visible', pointerEvents: showBenchmarks ? 'none' : 'auto' }}
				>
				<dl className={styles.detailGrid} style={{ gridTemplateColumns: `repeat(${metadataRows.length}, 1fr)` }}>
					{metadataRows.map(([label, value]) => (
						<div key={label} className={styles.detailItem}>
							<dt className={styles.detailLabel}>{label}</dt>
							<dd className={styles.detailValue}>{value}</dd>
						</div>
					))}
				</dl>

				{isVlm && dataset.qa_type && dataset.qa_type.length > 0 && (
					<section className={styles.section}>
						<h3 className={styles.sectionTitle}>QA Types</h3>
						<div className={styles.badgeWrap}>
							{dataset.qa_type.map((value) => (
								<span key={value} className={styles.tag}>{toTitleCase(value)}</span>
							))}
						</div>
					</section>
				)}

				{isVlm && dataset.task_dimensions && dataset.task_dimensions.length > 0 && (
					<section className={styles.section}>
						<h3 className={styles.sectionTitle}>Task Dimensions</h3>
						<div className={styles.badgeWrap}>
							{dataset.task_dimensions.map((value) => (
								<span key={value} className={styles.tag}>{toTitleCase(value)}</span>
							))}
						</div>
					</section>
				)}

				{isVlm && dataset.source_datasets && dataset.source_datasets.length > 0 && (
					<section className={styles.section}>
						<h3 className={styles.sectionTitle}>Source Datasets</h3>
						<div className={styles.badgeWrap}>
							{dataset.source_datasets.map((sourceDataset) => (
								<span key={sourceDataset} className={styles.tag}>{sourceDataset}</span>
							))}
						</div>
					</section>
				)}

				{cropList.length > 0 && (
					<section className={styles.section}>
						<h3 className={styles.sectionTitle}>Crops</h3>
						<div className={styles.badgeWrap}>
							{(cropsExpanded ? cropList : cropList.slice(0, 10)).map((crop) => (
								<span key={crop} className={styles.tag}>{crop}</span>
							))}
							{!cropsExpanded && cropList.length > 10 && (
								<button type="button" className={styles.expandButton} onClick={() => setCropsExpanded(true)}>
									+{cropList.length - 10} more
								</button>
							)}
						</div>
					</section>
				)}

				{classList.length > 0 && (
					<section className={styles.section}>
						<h3 className={styles.sectionTitle}>Classes</h3>
						<div className={styles.badgeWrap}>
							{(classesExpanded ? classList : classList.slice(0, 10)).map((cls) => (
								<span key={cls} className={styles.tag}>{cls}</span>
							))}
							{!classesExpanded && classList.length > 10 && (
								<button type="button" className={styles.expandButton} onClick={() => setClassesExpanded(true)}>
									+{classList.length - 10} more
								</button>
							)}
						</div>
					</section>
				)}

				{(dataset.stats_mean || dataset.stats_std) && (
					<section className={styles.section}>
						<h3 className={styles.sectionTitle}>Stats</h3>
						<p className={styles.bodyText}>
							<span className={styles.inlineLabel}>Mean:</span> {formatArray(dataset.stats_mean)}
						</p>
						<p className={styles.bodyText}>
							<span className={styles.inlineLabel}>Std:</span> {formatArray(dataset.stats_std)}
						</p>
					</section>
				)}

				<section className={styles.section}>
					<h3 className={styles.sectionTitle}>Sample image</h3>
					{hasExampleImage(dataset.examples_image_url) ? (
						<figure className={styles.figure}>
							<img className={styles.exampleImage} src={dataset.examples_image_url} alt={`Example for ${dataset.name}`} />
						</figure>
					) : (
						<p className={styles.bodyText}>No example image is available for this dataset.</p>
					)}
				</section>

				<section className={styles.section}>
					<h3 className={styles.sectionTitle}>{loader.title}</h3>
					<div className={styles.snippetRow}>
						<span className={styles.snippetCode}>{loader.code}</span>
						<button
							type="button"
							className={styles.snippetCopyButton}
							onClick={() => {
								navigator.clipboard.writeText(loader.code);
								setCopied(true);
								setTimeout(() => setCopied(false), 1500);
							}}
						>
							{copied ? 'Copied!' : 'Copy'}
						</button>
					</div>
				</section>

				{(dataset.documentation || dataset.hf_link) && (
					<div className={styles.linkRow}>
						{dataset.documentation && (
							<a className={styles.externalLink} href={dataset.documentation} target="_blank" rel="noreferrer">
								Open source documentation
							</a>
						)}
						{dataset.hf_link && (
							<a className={styles.hfLink} href={dataset.hf_link} target="_blank" rel="noreferrer">
								View on Hugging Face
							</a>
						)}
						{isVlm && dataset.parent_dataset && (
							<a className={styles.externalLink} href={dataset.parent_dataset} target="_blank" rel="noreferrer">
								View Original Dataset
							</a>
						)}
					</div>
				)}

				<section className={styles.section}>
					<h3 className={styles.sectionTitle}>
						Leaderboard{datasetPerformance.data?.metric ? ` — ${datasetPerformance.data.metric}` : ''}
					</h3>
					{datasetPerformance.loading ? (
						<p className={styles.bodyText}>Loading leaderboard…</p>
					) : datasetPerformance.data && datasetPerformance.data.entries.length > 0 ? (
						<div className={styles.leaderboardWrap}>
							<div className={styles.filterBar}>
								<InlineFilterGroup
									label="Metric type"
									options={metricTypeOptions}
									selected={metricTypeFilter}
									onToggle={(value) => toggleFilter(setMetricTypeFilter, value)}
									formatOption={(value) => METRIC_CATEGORY_LABELS[value as MetricCategory]}
								/>
								<InlineFilterGroup
									label="Tuned"
									options={tunedOptions}
									selected={tunedFilter}
									onToggle={(value) => toggleFilter(setTunedFilter, value)}
									formatOption={formatTunedKey}
								/>
								<InlineFilterGroup
									label="Optimized"
									options={optimizedOptions}
									selected={optimizedFilter}
									onToggle={(value) => toggleFilter(setOptimizedFilter, value)}
									formatOption={formatOptimizedKey}
								/>
								<InlineFilterGroup
									label="Platform"
									options={platformOptions}
									selected={platformFilter}
									onToggle={(value) => toggleFilter(setPlatformFilter, value)}
								/>
								<div className={styles.filterRange}>
									<label className={styles.filterRangeLabel}>Max train time (s/img)</label>
									<input
										type="number"
										placeholder="Max"
										value={trainingTimeMax}
										onChange={(event) => setTrainingTimeMax(event.target.value)}
										className={styles.filterRangeInput}
									/>
								</div>
								<div className={styles.filterRange}>
									<label className={styles.filterRangeLabel}>Min train split (%)</label>
									<input
										type="number"
										placeholder="Min"
										value={trainingSizeMin}
										onChange={(event) => setTrainingSizeMin(event.target.value)}
										className={styles.filterRangeInput}
									/>
								</div>
								{hasActiveLeaderboardFilters && (
									<button type="button" className={styles.clearFiltersButton} onClick={clearLeaderboardFilters}>
										Clear filters
									</button>
								)}
							</div>

							{filteredEntries.length === 0 ? (
								<p className={styles.bodyText}>No results match the selected filters.</p>
							) : (
								<div className={styles.tableWrap}>
									<div className={styles.leaderboardTable} role="table">
										<div className={styles.tableRow} role="row">
											<span role="columnheader">Rank</span>
											<span role="columnheader">Model</span>
											<span role="columnheader">Result</span>
											<span role="columnheader">Split%</span>
											<span role="columnheader">Config</span>
											<span role="columnheader">Scores</span>
											<span role="columnheader">Norm s/img</span>
											<span role="columnheader">Plat.</span>
										</div>
										{filteredEntries.map((entry, index) => {
											const rowKey = `${entry.model}-${entry.variant ?? 'default'}-${index}`;
											const isExpanded = expandedRowKeys.has(rowKey);
											return (
												<Fragment key={rowKey}>
													<div role="row" aria-expanded={isExpanded} className={styles.tableRow}>
														<span role="cell" className={styles.rankCell}>#{entry.rank ?? index + 1}</span>
														<span role="cell">
															<button type="button" className={styles.modelButton} onClick={() => toggleExpandedRow(rowKey)}>
																{entry.link ? (
																	<a
																		href={entry.link}
																		target="_blank"
																		rel="noreferrer"
																		onClick={(event) => event.stopPropagation()}
																	>
																		{entry.model}
																	</a>
																) : (
																	entry.model
																)}{' '}
																{isExpanded ? '▾' : '▸'}
															</button>
														</span>
														<span role="cell" className={styles.simpleCell}>{formatResultType(entry)}</span>
														<span role="cell" className={styles.simpleCell}>{entry.splitBreakdown ?? '—'}</span>
														<span role="cell" className={styles.simpleCell}>{entry.datasetConfig ?? '—'}</span>
														<span role="cell">
															{entry.metrics.length > 0 ? (
																<div className={styles.scoresCell}>
																	{entry.metrics.map((metric) => (
																		<span key={metric.key}>{metric.label}: {metric.value.toFixed(3)}</span>
																	))}
																</div>
															) : (
																<span className={styles.simpleCell}>{formatMetricScore(entry)}</span>
															)}
														</span>
														<span role="cell">
															<div className={styles.stackCell}>
																<span>train {formatTimePerImage(entry.trainTimePerImage)}</span>
																<span>inf {formatTimePerImage(entry.infTimePerImage)}</span>
															</div>
														</span>
														<span role="cell" className={styles.simpleCell}>{entry.platform ?? '—'}</span>
													</div>
													{isExpanded && (
														<div className={styles.notesRow}>
															<p className={styles.notesLabel}>Notes</p>
															<p className={styles.notesText}>{entry.notes ?? 'No additional notes for this result.'}</p>
														</div>
													)}
												</Fragment>
											);
										})}
									</div>
								</div>
							)}
						</div>
					) : (
						<p className={styles.bodyText}>No leaderboard results have been submitted for this dataset yet.</p>
					)}
				</section>
				</div>

				{benchmark && (
					<div
						className={`${styles.face} ${styles.faceBack} ${showBenchmarks ? '' : styles.faceHidden}`}
						style={{ visibility: showBenchmarks ? 'visible' : 'hidden', pointerEvents: showBenchmarks ? 'auto' : 'none' }}
					>
						<BenchmarkView benchmark={benchmark} embeddings={embeddings} />
					</div>
				)}
				</div>
			</div>
		</div>
	);
}
