import { Fragment, useEffect, useMemo, useState } from 'react';
import { useColorMode } from '@docusaurus/theme-common';
import type { Dataset } from '../lib/datasets';
import { formatDisplayLocation, toTitleCase } from '../lib/datasets';
import { toDisplayLabel } from '../lib/labelOverrides';
import {
	useBenchmark,
	type BenchmarkData,
	type EmbedPoint as RawEmbedPoint,
	type ReproducibilityInfo,
} from '../lib/benchmarks';
import { computeScores, type AxisScores } from '../lib/scoring';
import { METRIC_CATEGORY_LABELS, useDatasetPerformance } from '../lib/performance';
import type { MetricCategory, PerformanceEntry } from '../lib/performance';
import { oklchToRgb } from '../lib/plotlyChrome';
import { EmbeddingPlot2D } from './EmbeddingPlot2D';
import { EmbeddingPlot3D } from './EmbeddingPlot3D';
import { ScoringMethodologyModal } from './ScoringMethodologyModal';
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

function StatTile({ label, value, hint, info }: { label: string; value: string; hint?: string; info?: string }) {
	return (
		<div className={styles.statTile}>
			<p className={styles.statTileLabel}>
				{label}
				{info && <InfoTooltip text={info} />}
			</p>
			<p className={styles.statTileValue}>{value}</p>
			{hint && <p className={styles.statTileHint}>{hint}</p>}
		</div>
	);
}

type MetricBar = { label: string; value: string; pct: number; positive?: boolean };
type MetricStat = { label: string; value: string; hint?: string; info?: string };
type MetricStatSection = { title: string; description: string; badge?: string; stats: MetricStat[] };
// 'good' / 'mid' / 'poor' key into the same three-tier color scale used by the score boxes
// (--ifm-color-primary / --agml-caution-text / --agml-warning-text) so a cartography split and
// an axis score read as the same kind of judgment.
type ScoreTier = 'good' | 'mid' | 'poor';
type MetricSegment = { label: string; value: string; pct: number; tier: ScoreTier };
type ConfusionCell = { value: string; title: string; intensity: number; diagonal: boolean };
type ConfusionRow = { name: string; cells: ConfusionCell[] };
type MetricPair = { label: string; value: string };
type MetricCardVM =
	| { kind: 'bars'; title: string; description: string; badge?: string; bars: MetricBar[]; footerStats?: MetricStat[] }
	| { kind: 'signed'; title: string; description: string; badge?: string; bars: MetricBar[]; footerStats?: MetricStat[] }
	| { kind: 'stats'; title: string; description: string; badge?: string; wide?: boolean; stats: MetricStat[] }
	| { kind: 'stat-sections'; title: string; sections: MetricStatSection[] }
	| { kind: 'skipped'; title: string; message: string }
	| { kind: 'proportion'; title: string; description: string; badge?: string; segments: MetricSegment[]; footerStats?: MetricStat[] }
	| {
			kind: 'confusion';
			title: string;
			description: string;
			badge?: string;
			classNames: string[];
			rows: ConfusionRow[];
			overflowNote?: string;
			pairs: MetricPair[];
			footerStats?: MetricStat[];
	  };

function buildMetricCards(benchmark: BenchmarkData): MetricCardVM[] {
	const m = benchmark.metrics;
	const cards: MetricCardVM[] = [];

	if (m.class_imbalance) {
		const d = m.class_imbalance;
		const max = Math.max(...Object.values(d.counts));
		cards.push({
			kind: 'bars',
			title: 'Class Imbalance',
			description:
				'How evenly the classes are represented. Imbalance ratio is the most-frequent class’s count divided by the least-frequent’s (1.0 = perfectly balanced, higher = more skewed). Normalized entropy ranges 0–1, where 1 means every class has an equal share.',
			badge: `${d.total_train_examples} train examples`,
			bars: Object.entries(d.counts)
				.map(([label, value]) => ({ label: toTitleCase(label), value: value.toLocaleString(), pct: (value / max) * 100 }))
				.sort((a, b) => b.pct - a.pct),
			footerStats: [
				{
					label: 'Imbalance ratio',
					value: d.imbalance_ratio.toFixed(2),
					info: 'Most-frequent class count ÷ least-frequent. 1.0 = perfectly balanced; higher = more skewed.',
				},
				{
					label: 'Norm. entropy',
					value: d.normalized_entropy.toFixed(2),
					info: 'Normalized entropy, 0–1. 1 = every class has an equal share; lower = more concentrated.',
				},
				{ label: 'Most frequent', value: toTitleCase(d.most_frequent_class), info: 'Class with the most training examples.' },
				{ label: 'Least frequent', value: toTitleCase(d.least_frequent_class), info: 'Class with the fewest training examples.' },
			],
		});
	}

	if (m.exact_duplicate || m.near_duplicate) {
		const sections: MetricStatSection[] = [];

		if (m.exact_duplicate) {
			const d = m.exact_duplicate;
			sections.push({
				title: 'Exact',
				description:
					'Images that are byte-for-byte identical to another image in the dataset. A high duplicate rate inflates the apparent dataset size and can leak the same example across train/test splits, making evaluation look better than it is.',
				badge: `${d.total_images} images`,
				stats: [
					{ label: 'Duplicate count', value: String(d.exact_duplicate_count), info: 'Images that are byte-for-byte identical to another image in the dataset.' },
					{
						label: 'Duplicate rate',
						value: `${(d.exact_duplicate_rate * 100).toFixed(1)}%`,
						info: 'Share of images that are exact duplicates. A higher rate inflates the apparent dataset size.',
					},
					{ label: 'Groups', value: String(d.duplicate_groups), info: 'Number of distinct sets of identical images.' },
					{
						label: 'Cross-split',
						value: String(d.cross_split_duplicates),
						info: 'Duplicates that appear across train/test splits — a direct source of evaluation leakage.',
					},
				],
			});
		}

		if (m.near_duplicate) {
			const d = m.near_duplicate;
			sections.push({
				title: 'Near',
				description:
					'Images that are nearly identical (crops, recompressions, small edits) based on embedding similarity above a threshold — not exact byte matches. High near-duplicate rates risk train/test leakage even when the exact-duplicate count is zero.',
				badge: d.embed_model,
				stats: [
					{
						label: 'Near-dup count',
						value: String(d.near_duplicate_count),
						info: 'Images that are nearly identical (crops, recompressions, small edits) by embedding similarity — not exact byte matches.',
					},
					{ label: 'Near-dup rate', value: `${(d.near_duplicate_rate * 100).toFixed(1)}%`, info: 'Share of images that are near-duplicates.' },
					{ label: 'Groups', value: String(d.near_duplicate_groups), info: 'Number of distinct near-duplicate clusters.' },
					{
						label: 'Cross-split',
						value: String(d.cross_split_near_duplicates),
						info: 'Near-duplicates spanning train/test splits — risks leakage even when the exact-duplicate count is zero.',
					},
					{ label: 'Threshold', value: String(d.threshold), info: 'Cosine-similarity cutoff above which two images count as near-duplicates.' },
					{ label: 'Index type', value: d.faiss_index_type, info: 'FAISS index type used for the similarity search.' },
				],
			});
		}

		cards.push({ kind: 'stat-sections', title: 'Duplicate Detection', sections });
	}

	if (m.resolution_consistency) {
		const d = m.resolution_consistency;
		cards.push({
			kind: 'stats',
			title: 'Resolution Consistency',
			wide: true,
			description:
				'How uniform image dimensions and aspect ratios are across the dataset. Area CV (coefficient of variation) near 0 means sizes barely vary; higher values mean preprocessing has to handle a wide range of source resolutions.',
			badge: `${d.total_images} images`,
			stats: [
				{ label: 'Width (mean)', value: `${d.width.mean}px`, info: 'Average image width in pixels.' },
				{ label: 'Height (μ±σ)', value: `${d.height.mean.toFixed(0)}±${d.height.std.toFixed(1)}`, info: 'Average image height ± standard deviation, in pixels.' },
				{
					label: 'Aspect ratio',
					value: `${d.aspect_ratio.mean.toFixed(2)} (${d.aspect_ratio.min.toFixed(2)}–${d.aspect_ratio.max.toFixed(2)})`,
					info: 'Mean aspect ratio, with the min–max range across the dataset in parentheses.',
				},
				{
					label: 'Area CV',
					value: d.area_cv.toFixed(3),
					info: 'Coefficient of variation of image area. Near 0 = uniform sizes; higher = a wide range of source resolutions.',
				},
				{ label: 'Color mode', value: Object.keys(d.mode_distribution).join(', '), info: 'Image color modes present in the dataset (e.g. RGB, L).' },
			],
		});
	}

	if (m.feature_separability) {
		const d = m.feature_separability;
		cards.push({
			kind: 'signed',
			title: 'Feature Separability',
			description:
				'How distinctly the classes cluster in embedding space. Silhouette score ranges −1 to 1 (higher = better-separated clusters, near 0 = overlapping, negative = points closer to another class than their own — often mislabeled or genuinely ambiguous). Davies-Bouldin index is ≥0 and unbounded, where lower means better separation.',
			badge: d.embed_model,
			bars: Object.entries(d.per_class_silhouette)
				.map(([label, value]) => ({
					label: toTitleCase(label),
					value: value.toFixed(2),
					pct: Math.abs(value) * 50,
					positive: value >= 0,
				}))
				.sort((a, b) => b.pct - a.pct),
			footerStats: [
				{
					label: 'Silhouette',
					value: d.silhouette_score.toFixed(2),
					hint: d.silhouette_interpretation,
					info: 'Ranges −1 to 1. Higher = better-separated clusters; near 0 = overlapping; negative = points closer to another class than their own.',
				},
				{
					label: 'Davies-Bouldin',
					value: d.davies_bouldin_index.toFixed(2),
					hint: d.davies_bouldin_interpretation,
					info: 'Index ≥ 0 and unbounded. Lower means better separation between classes.',
				},
			],
		});
	}

	if (m.intra_class_diversity) {
		const d = m.intra_class_diversity;
		const max = Math.max(...Object.values(d.per_class_diversity));
		cards.push({
			kind: 'bars',
			title: 'Intra-class Diversity',
			description:
				'How visually varied the images within each class are, based on average embedding distance between same-class examples. Higher values mean more diverse, less redundant examples per class; a very low value can mean that class is dominated by near-duplicates.',
			badge: d.embed_model,
			bars: Object.entries(d.per_class_diversity)
				.map(([label, value]) => ({ label: toTitleCase(label), value: value.toFixed(2), pct: (value / max) * 100 }))
				.sort((a, b) => b.pct - a.pct),
			footerStats: [
				{
					label: 'Mean diversity',
					value: d.mean_diversity.toFixed(2),
					info: 'Average embedding distance between same-class images, averaged over classes. Higher = more varied, less redundant.',
				},
				{ label: 'Min class', value: toTitleCase(d.min_diversity_class), info: 'Class with the least visual variety — possibly dominated by near-duplicates.' },
				{ label: 'Max class', value: toTitleCase(d.max_diversity_class), info: 'Class with the most visual variety.' },
			],
		});
	}

	if (m.metadata_coverage?.skipped) {
		cards.push({ kind: 'skipped', title: 'Metadata Coverage', message: m.metadata_coverage.reason || 'Skipped for this run.' });
	}

	const backbone = benchmark.reproducibility?.backbone;

	if (m.dataset_cartography) {
		const d = m.dataset_cartography;
		cards.push({
			kind: 'proportion',
			title: 'Dataset Cartography',
			description:
				'Prediction confidence and variability across training epochs from a reference model, sorting examples into easy, ambiguous, or hard-to-learn based on how consistently the model got them right.',
			badge: backbone ? `${backbone} · ${d.n_epochs} epochs` : `${d.n_epochs} epochs`,
			segments: [
				{ label: 'Easy', pct: d.pct_easy, value: `${d.n_easy.toLocaleString()} (${d.pct_easy.toFixed(1)}%)`, tier: 'good' },
				{ label: 'Ambiguous', pct: d.pct_ambiguous, value: `${d.n_ambiguous.toLocaleString()} (${d.pct_ambiguous.toFixed(1)}%)`, tier: 'mid' },
				{ label: 'Hard', pct: d.pct_hard, value: `${d.n_hard.toLocaleString()} (${d.pct_hard.toFixed(1)}%)`, tier: 'poor' },
			],
			footerStats: [
				{
					label: 'Mean confidence',
					value: d.mean_confidence.toFixed(2),
					info: 'Average model confidence on its predicted class across training epochs.',
				},
				{
					label: 'Mean variability',
					value: d.mean_variability.toFixed(2),
					info: 'Average variance of that confidence across epochs — high variability means the model flip-flops on that example.',
				},
			],
		});
	}

	if (m.class_confusability) {
		const d = m.class_confusability;
		const allNames = Object.keys(d.per_class_accuracy);
		let keepIdx = allNames.map((_, i) => i);
		if (allNames.length > CONFUSION_CAP) {
			keepIdx = allNames
				.map((name, i): [number, number] => [i, d.per_class_accuracy[name]])
				.sort((a, b) => a[1] - b[1])
				.slice(0, CONFUSION_CAP)
				.map(([i]) => i)
				.sort((a, b) => a - b);
		}
		const classNames = keepIdx.map((i) => toTitleCase(allNames[i]));
		const rows: ConfusionRow[] = keepIdx.map((ri, rowPos) => ({
			name: classNames[rowPos],
			cells: keepIdx.map((ci) => {
				const value = d.confusion_matrix[ri][ci];
				return {
					value: (value * 100).toFixed(0),
					title: `${toTitleCase(allNames[ri])} → ${toTitleCase(allNames[ci])}: ${(value * 100).toFixed(1)}%`,
					intensity: Math.max(0.06, value),
					diagonal: ri === ci,
				};
			}),
		}));
		const overflowNote =
			allNames.length > CONFUSION_CAP
				? `Showing ${CONFUSION_CAP} of ${allNames.length} classes (lowest accuracy) — hover cells for exact values`
				: undefined;
		cards.push({
			kind: 'confusion',
			title: 'Class Confusability',
			description: 'Confusion matrix from a reference model on held-out data, highlighting class pairs that are visually hard to tell apart.',
			badge: backbone ? `${backbone} · ${(d.accuracy * 100).toFixed(1)}% acc.` : `${(d.accuracy * 100).toFixed(1)}% acc.`,
			classNames,
			rows,
			overflowNote,
			pairs: d.top_confused_pairs.map((p) => ({
				label: `${toTitleCase(p.true_class)} → ${toTitleCase(p.predicted_as)}`,
				value: `${(p.confusion_rate * 100).toFixed(1)}%`,
			})),
			footerStats: [
				{ label: 'Overall accuracy', value: `${(d.accuracy * 100).toFixed(1)}%`, info: 'Accuracy of the reference model on held-out test data.' },
				{ label: 'Test samples', value: String(d.n_test_samples), info: 'Number of held-out samples used to compute this confusion matrix.' },
			],
		});
	}

	if (m.label_noise) {
		const d = m.label_noise;
		const max = Math.max(...Object.values(d.per_class_noise_counts));
		cards.push({
			kind: 'bars',
			title: 'Label Noise',
			description:
				'Out-of-fold predictions from k-fold cross-validation, flagged via confident-learning (cleanlab-style) methods to estimate the mislabeled rate per class.',
			badge: backbone
				? `${backbone} · ${(d.estimated_noise_rate * 100).toFixed(1)}% est. rate`
				: `${(d.estimated_noise_rate * 100).toFixed(1)}% est. rate`,
			bars: Object.entries(d.per_class_noise_counts)
				.map(([label, value]) => ({ label: toTitleCase(label), value: String(value), pct: max ? (value / max) * 100 : 0 }))
				.sort((a, b) => b.pct - a.pct),
			footerStats: [
				{ label: 'Noisy samples', value: `${d.n_noisy_samples} / ${d.n_total_samples}`, info: 'Samples flagged as likely mislabeled, out of the total evaluated.' },
				{ label: 'CV folds', value: String(d.cv_folds), info: 'Number of cross-validation folds used to generate out-of-fold predictions.' },
			],
		});
	}

	return cards;
}

// A plain ascending-bars glyph in currentColor — matches the rest of the header's monochrome
// icon language (×, ←) instead of a colorful emoji that clashes with it.
function BenchmarkIcon() {
	return (
		<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
			<rect x="1.5" y="9" width="3" height="5.5" rx="0.5" fill="currentColor" />
			<rect x="6.5" y="5" width="3" height="9.5" rx="0.5" fill="currentColor" />
			<rect x="11.5" y="1.5" width="3" height="13" rx="0.5" fill="currentColor" />
		</svg>
	);
}

function InfoTooltip({ text }: { text: string }) {
	return (
		<span className={styles.infoTooltip} tabIndex={0} aria-label={text}>
			<span className={styles.infoTooltipIcon} aria-hidden="true">
				i
			</span>
			<span className={styles.infoTooltipBubble}>{text}</span>
		</span>
	);
}

// Above this many bars, a card shows only the top BAR_CAP (already sorted descending in
// buildMetricCards) with a "Show all N →" link instead of every class at once.
const BAR_CAP = 8;

// Above this many classes, the confusion matrix shows only the CONFUSION_CAP lowest-accuracy
// classes (the ones most worth looking at) instead of a matrix too wide to read.
const CONFUSION_CAP = 12;

// Above this many confused pairs, only the top 3 show before a "Show all N →" link.
const PAIR_CAP = 3;

// Bar-chart, signed-diverging, and confusion-matrix cards read better wider (long class lists,
// wide grids), so they span 2 grid columns while stat-only cards stay at 1 — paired with
// grid-auto-flow: dense on .metricCardGrid so 1-column cards backfill the gaps.
function isWideCard(card: MetricCardVM): boolean {
	return card.kind === 'bars' || card.kind === 'signed' || card.kind === 'confusion' || (card.kind === 'stats' && !!card.wide);
}

const METRIC_AXES = ['Structural Quality', 'Content Difficulty', 'Diversity & Coverage', 'Annotation Reliability'] as const;
const METRIC_AXIS_MAP: Record<string, (typeof METRIC_AXES)[number]> = {
	'Class Imbalance': 'Structural Quality',
	'Duplicate Detection': 'Structural Quality',
	'Resolution Consistency': 'Structural Quality',
	'Dataset Cartography': 'Content Difficulty',
	'Class Confusability': 'Content Difficulty',
	'Feature Separability': 'Content Difficulty',
	'Intra-class Diversity': 'Diversity & Coverage',
	'Metadata Coverage': 'Diversity & Coverage',
	'Label Noise': 'Annotation Reliability',
};

function MetricCard({ card }: { card: MetricCardVM }) {
	const [expanded, setExpanded] = useState(false);
	const [pairsExpanded, setPairsExpanded] = useState(false);
	const badge = card.kind !== 'skipped' && card.kind !== 'stat-sections' ? card.badge : undefined;
	const allBars = card.kind === 'bars' || card.kind === 'signed' ? card.bars : undefined;
	const hasMoreBars = Boolean(allBars && allBars.length > BAR_CAP);
	const visibleBars = allBars ? (expanded || !hasMoreBars ? allBars : allBars.slice(0, BAR_CAP)) : undefined;
	const hasMorePairs = card.kind === 'confusion' && card.pairs.length > PAIR_CAP;
	const visiblePairs = card.kind === 'confusion' ? (pairsExpanded || !hasMorePairs ? card.pairs : card.pairs.slice(0, PAIR_CAP)) : undefined;

	return (
		<div className={`${styles.metricCard} ${isWideCard(card) ? styles.metricCardSpan2 : ''}`}>
			<div className={styles.metricCardHeader}>
				<div className={styles.metricCardTitleRow}>
					<h4 className={styles.metricCardTitle}>{card.title}</h4>
					{card.kind !== 'skipped' && card.kind !== 'stat-sections' && <InfoTooltip text={card.description} />}
				</div>
				{badge && <span className={styles.metricCardBadge}>{badge}</span>}
			</div>

			{card.kind === 'skipped' && <p className={styles.metricSkipped}>Skipped — {card.message}</p>}

			{card.kind === 'stat-sections' && (
				<div className={styles.metricStatSections}>
					{card.sections.map((section) => (
						<div key={section.title} className={styles.metricStatSection}>
							<div className={styles.metricCardHeader}>
								<div className={styles.metricCardTitleRow}>
									<h5 className={styles.metricStatSectionTitle}>{section.title}</h5>
									<InfoTooltip text={section.description} />
								</div>
								{section.badge && <span className={styles.metricCardBadge}>{section.badge}</span>}
							</div>
							<div className={styles.statTileGrid}>
								{section.stats.map((stat) => (
									<StatTile key={stat.label} label={stat.label} value={stat.value} hint={stat.hint} info={stat.info} />
								))}
							</div>
						</div>
					))}
				</div>
			)}

			{visibleBars && (
				<div className={`${styles.metricBars} ${expanded ? styles.metricBarsExpanded : ''}`}>
					{visibleBars.map((bar) => (
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

			{hasMoreBars && allBars && (
				<button type="button" className={styles.metricExpandLink} onClick={() => setExpanded((value) => !value)}>
					{expanded ? '← Show fewer' : `Show all ${allBars.length} →`}
				</button>
			)}

			{card.kind === 'stats' && (
				<div className={styles.statTileGrid}>
					{card.stats.map((stat) => (
						<StatTile key={stat.label} label={stat.label} value={stat.value} hint={stat.hint} info={stat.info} />
					))}
				</div>
			)}

			{card.kind === 'proportion' && (
				<>
					<div className={styles.proportionBar}>
						{card.segments.map((seg) => (
							<div
								key={seg.label}
								className={styles.proportionSegment}
								data-tier={seg.tier}
								style={{ width: `${seg.pct}%` }}
								title={`${seg.label}: ${seg.value}`}
							/>
						))}
					</div>
					<div className={styles.proportionTileGrid}>
						{card.segments.map((seg) => (
							<div key={seg.label} className={styles.proportionTile} data-tier={seg.tier}>
								<p className={styles.statTileLabel}>
									<span className={styles.proportionDot} data-tier={seg.tier} aria-hidden="true" />
									{seg.label}
								</p>
								<p className={styles.statTileValue}>{seg.value}</p>
							</div>
						))}
					</div>
				</>
			)}

			{card.kind === 'confusion' && (
				<>
					<div className={styles.confusionWrap}>
						<div className={styles.confusionGrid} style={{ gridTemplateColumns: `84px repeat(${card.classNames.length}, 34px)` }}>
							<span className={styles.confusionCorner} aria-hidden="true" />
							{card.classNames.map((name) => (
								<span key={`col-${name}`} className={styles.confusionColHeader} title={name}>
									{name}
								</span>
							))}
							{card.rows.map((row) => (
								<Fragment key={row.name}>
									<span className={styles.confusionRowHeader} title={row.name}>
										{row.name}
									</span>
									{row.cells.map((cell, cellIndex) => (
										<span
											key={cellIndex}
											className={styles.confusionCell}
											title={cell.title}
											style={{ background: `oklch(0.55 0.14 ${cell.diagonal ? 150 : 40} / ${cell.intensity})` }}
										>
											{cell.value}
										</span>
									))}
								</Fragment>
							))}
						</div>
					</div>
					{card.overflowNote && <p className={styles.metricOverflowNote}>{card.overflowNote}</p>}
					{card.pairs.length > 0 ? (
						<div className={styles.confusionPairs}>
							<p className={styles.confusionPairsHeader}>Top confused pairs</p>
							<div className={hasMorePairs && pairsExpanded ? styles.confusionPairsListExpanded : styles.confusionPairsList}>
								{visiblePairs?.map((pair) => (
									<div key={pair.label} className={styles.confusionPairRow}>
										<span>{pair.label}</span>
										<span>{pair.value}</span>
									</div>
								))}
							</div>
							{hasMorePairs && (
								<button type="button" className={styles.metricExpandLink} onClick={() => setPairsExpanded((value) => !value)}>
									{pairsExpanded ? '← Show fewer' : `Show all ${card.pairs.length} →`}
								</button>
							)}
						</div>
					) : (
						<p className={styles.metricSkipped}>No confused pairs — every class was classified perfectly.</p>
					)}
				</>
			)}

			{'footerStats' in card && card.footerStats && card.footerStats.length > 0 && (
				<div className={styles.metricFooterStats}>
					{card.footerStats.map((stat) => (
						<StatTile key={stat.label} label={stat.label} value={stat.value} hint={stat.hint} info={stat.info} />
					))}
				</div>
			)}
		</div>
	);
}

// A fixed palette repeats (or blurs together) past a handful of classes, so class colors are
// generated procedurally instead: step the hue by 47° per class (coprime-ish with 360, so
// hues don't cluster or repeat for a long time) at a lightness/chroma tuned per theme.
function classColor(index: number, isDark: boolean): string {
	const hue = (index * 47) % 360;
	const lightness = isDark ? 0.72 : 0.5;
	const chroma = isDark ? 0.13 : 0.12;
	return oklchToRgb(lightness, chroma, hue);
}

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

export interface EmbedPoint {
	id: string;
	cls: string;
	split: string;
	index: number;
	x: number;
	y: number;
	z: number;
}

function embedPointsFromReal(embeddings: RawEmbedPoint[]): EmbedPoint[] {
	return embeddings.map((p, i) => ({
		id: `${p.label}-${p.index ?? i}`,
		cls: p.label,
		split: p.split ?? 'train',
		index: p.index ?? i,
		x: p.x,
		y: p.y,
		z: p.z ?? 0,
	}));
}

function buildEmbeddingPoints(benchmark: BenchmarkData): EmbedPoint[] {
	const counts = benchmark.metrics.class_imbalance?.counts ?? {};
	const sep = benchmark.metrics.feature_separability?.per_class_silhouette ?? {};
	const classes = Object.keys(counts);
	const rand = mulberry32(42);
	const splits = ['train', 'val', 'test'];
	const points: EmbedPoint[] = [];
	let globalIndex = 0;
	classes.forEach((cls, i) => {
		const center = EMBED_CLUSTER_CENTERS[i % EMBED_CLUSTER_CENTERS.length];
		const sil = sep[cls] ?? 0.3;
		const spread = 0.22 + Math.max(0, 0.65 - sil) * 0.55;
		const n = Math.max(6, Math.round((counts[cls] || 30) / 8));
		for (let k = 0; k < n; k += 1) {
			const jitter = () => (((rand() + rand() + rand()) - 1.5) / 1.5) * spread;
			points.push({
				id: `${cls}-${k}`,
				cls,
				split: splits[globalIndex % splits.length],
				index: globalIndex,
				x: center[0] + jitter(),
				y: center[1] + jitter(),
				z: center[2] + jitter(),
			});
			globalIndex += 1;
		}
	});
	return points;
}

function buildClassColorMap(points: EmbedPoint[], isDark: boolean): Record<string, string> {
	const labels = Array.from(new Set(points.map((p) => p.cls))).sort();
	return Object.fromEntries(labels.map((label, i) => [label, classColor(i, isDark)]));
}

// Beyond this many classes, the legend switches from listing every one to a "+N more" note —
// past ~10 swatches a legend stops being scannable anyway.
const LEGEND_CAP = 10;

function EmbeddingScatter({
	benchmark,
	embeddings2d,
	embeddings3d,
}: {
	benchmark: BenchmarkData;
	embeddings2d: RawEmbedPoint[] | null;
	embeddings3d: RawEmbedPoint[] | null;
}) {
	const [view, setView] = useState<'2d' | '3d'>('2d');
	const { colorMode } = useColorMode();

	// 2D and 3D UMAP projections are independently fit, so they're separate point sets —
	// not the same points with one axis dropped.
	const activeRaw = view === '2d' ? embeddings2d : embeddings3d;
	const hasRealEmbeddings = Boolean(activeRaw && activeRaw.length > 0);
	const points = useMemo(() => {
		if (activeRaw && activeRaw.length > 0) return embedPointsFromReal(activeRaw);
		return buildEmbeddingPoints(benchmark);
	}, [activeRaw, benchmark]);

	const colorMap = useMemo(() => buildClassColorMap(points, colorMode === 'dark'), [points, colorMode]);

	const embedModel = benchmark.metrics.feature_separability?.embed_model ?? 'dinov2-base';

	return (
		<section className={styles.section}>
			<div className={styles.embedHeader}>
				<div>
					<h3 className={styles.sectionTitle}>Embedding Space — UMAP</h3>
					<span className={styles.tag}>{embedModel}</span>
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

			{view === '2d' ? (
				<EmbeddingPlot2D points={points} colorMap={colorMap} />
			) : (
				<EmbeddingPlot3D points={points} colorMap={colorMap} />
			)}

			<div className={styles.embedLegend}>
				{Object.entries(colorMap)
					.slice(0, LEGEND_CAP)
					.map(([key, color]) => (
						<span key={key} className={styles.embedLegendItem}>
							<span className={styles.embedLegendDot} style={{ background: color }} />
							{toTitleCase(key)}
						</span>
					))}
				{Object.keys(colorMap).length > LEGEND_CAP && (
					<span className={styles.embedLegendOverflow}>
						+{Object.keys(colorMap).length - LEGEND_CAP} more (hover points for class)
					</span>
				)}
			</div>
			<p className={styles.embedNote}>
				{hasRealEmbeddings
					? `projected from real ${view.toUpperCase()} UMAP embeddings`
					: `no ${view.toUpperCase()} UMAP embeddings found for this dataset · showing a seeded demo scatter around class clusters`}
			</p>
		</section>
	);
}

function formatBenchmarkDate(dateStr: string): string {
	const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
	if (!match) return dateStr;
	const [, year, month, day] = match;
	return `${month}/${day}/${year}`;
}

// Same three-tier thresholds as the axis-score gauge below, on the doc's 0–10 scale.
function scoreTier(value: number): ScoreTier {
	if (value >= 7.5) return 'good';
	if (value >= 5) return 'mid';
	return 'poor';
}

type ScoreBoxVM = { label: string; value: string; tier: ScoreTier };

function buildScoreBoxes(scores: AxisScores): ScoreBoxVM[] {
	const entries: { label: string; value: number | null }[] = [
		{ label: 'Overall', value: scores.overall },
		{ label: 'Structural Quality', value: scores.structural },
		{ label: 'Content Difficulty', value: scores.difficulty },
		{ label: 'Diversity & Coverage', value: scores.diversity },
		{ label: 'Annotation Reliability', value: scores.annotation },
	];
	return entries
		.filter((entry): entry is { label: string; value: number } => entry.value != null)
		.map((entry) => ({ label: entry.label, value: entry.value.toFixed(1), tier: scoreTier(entry.value) }));
}

type ReproRowVM = { label: string; value: string };

function buildReproRows(info: ReproducibilityInfo | undefined): ReproRowVM[] {
	if (!info) return [];
	const rows: ReproRowVM[] = [];
	if (info.split_seed != null) rows.push({ label: 'Split seed', value: String(info.split_seed) });
	if (info.train_ratio != null && info.val_ratio != null && info.test_ratio != null) {
		rows.push({
			label: 'Train / val / test',
			value: `${Math.round(info.train_ratio * 100)} / ${Math.round(info.val_ratio * 100)} / ${Math.round(info.test_ratio * 100)}`,
		});
	}
	if (info.embed_model) rows.push({ label: 'Embed model', value: info.embed_model });
	if (info.near_dup_threshold != null) rows.push({ label: 'Near-dup threshold', value: String(info.near_dup_threshold) });
	if (info.backbone) rows.push({ label: 'Reference backbone', value: info.backbone });
	if (info.cartography_epochs != null) {
		rows.push({
			label: 'Cartography epochs',
			value: info.cartography_lr != null ? `${info.cartography_epochs} (lr ${info.cartography_lr})` : String(info.cartography_epochs),
		});
	}
	if (info.cv_folds != null) rows.push({ label: 'CV folds', value: String(info.cv_folds) });
	return rows;
}

function BenchmarkView({
	benchmark,
	embeddings2d,
	embeddings3d,
}: {
	benchmark: BenchmarkData;
	embeddings2d: RawEmbedPoint[] | null;
	embeddings3d: RawEmbedPoint[] | null;
}) {
	const cards = useMemo(() => buildMetricCards(benchmark), [benchmark]);
	const scores = useMemo(() => computeScores(benchmark), [benchmark]);
	const scoreBoxes = useMemo(() => buildScoreBoxes(scores), [scores]);
	const reproRows = useMemo(() => buildReproRows(benchmark.reproducibility), [benchmark.reproducibility]);
	const axisGroups = useMemo(
		() =>
			METRIC_AXES.map((axis) => ({ axis, cards: cards.filter((card) => METRIC_AXIS_MAP[card.title] === axis) })).filter(
				(group) => group.cards.length > 0,
			),
		[cards],
	);

	return (
		<div>
			<p className={styles.benchmarkRunNote}>Last benchmarking check run: {formatBenchmarkDate(benchmark.date)}</p>

			{reproRows.length > 0 && (
				<details className={styles.reproDetails}>
					<summary className={styles.reproSummary}>Reproducibility details</summary>
					<div className={styles.reproGrid}>
						{reproRows.map((row) => (
							<span key={row.label} className={styles.reproTag}>
								<span className={styles.reproTagKey}>{row.label}</span>
								<span className={styles.reproTagValue} title={row.value}>
									{row.value}
								</span>
							</span>
						))}
					</div>
				</details>
			)}

			{scoreBoxes.length > 0 && (
				<div className={styles.scoreRow}>
					{scoreBoxes.map((box) => (
						<div key={box.label} className={styles.scoreBox} data-tier={box.tier}>
							<p className={styles.scoreBoxLabel} title={box.label}>
								{box.label}
							</p>
							<p className={styles.scoreBoxValue}>{box.value}</p>
						</div>
					))}
				</div>
			)}

			<br/>

			{axisGroups.map((group) => (
				<section key={group.axis} className={styles.axisSection}>
					<h3 className={styles.axisTitle}>{group.axis}</h3>
					<div className={styles.metricCardGrid}>
						{group.cards.map((card) => (
							<MetricCard key={card.title} card={card} />
						))}
					</div>
				</section>
			))}

			<section className={styles.axisSection}>
				<h3 className={styles.axisTitle}>Visualization</h3>
				<EmbeddingScatter benchmark={benchmark} embeddings2d={embeddings2d} embeddings3d={embeddings3d} />
			</section>
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
	const { data: benchmark, embeddings2d, embeddings3d } = useBenchmark(open ? (dataset?.name ?? null) : null);
	const [showBenchmarks, setShowBenchmarks] = useState(false);
	useEffect(() => setShowBenchmarks(false), [dataset?.name, open]);
	const [showMethodology, setShowMethodology] = useState(false);

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
								{showBenchmarks ? (
									'Dataset Details'
								) : (
									<>
										<BenchmarkIcon /> View Benchmarks
									</>
								)}
							</button>
						)}
						{benchmark && showBenchmarks && (
							<button type="button" className={styles.methodologyLink} onClick={() => setShowMethodology(true)}>
								ⓘ How scores are calculated
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
						<BenchmarkView benchmark={benchmark} embeddings2d={embeddings2d} embeddings3d={embeddings3d} />
					</div>
				)}
				</div>
			</div>

			<ScoringMethodologyModal
				open={showMethodology}
				taskType="Image Classification"
				onClose={() => setShowMethodology(false)}
			/>
		</div>
	);
}
