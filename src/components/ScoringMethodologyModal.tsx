// Static reference modal explaining how dataset quality scores are computed. Unlike the rest
// of the benchmarking UI, nothing here is driven by a specific dataset's data — it's the same
// content for every dataset, documenting the formulas in SCORING_FORMULAS.md in plain language.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './ScoringMethodologyModal.module.css';

type MetricDoc = {
	name: string;
	weight?: string;
	badge?: string;
	how: string;
	formula?: string;
	meaning: string;
	interpretation: string;
	isPenalty?: boolean;
	isPending?: boolean;
};

type AxisKey = 'structural' | 'difficulty' | 'diversity' | 'annotation';

type AxisDoc = {
	key: AxisKey;
	name: string;
	description: string;
	metrics: MetricDoc[];
	axisFormula: string;
};

const TASK_TYPES = ['Image Classification', 'Object Detection', 'Image Segmentation', 'Image Text To Text'] as const;
type TaskType = (typeof TASK_TYPES)[number];

const AXIS_WEIGHTS: { label: string; pct: string; key: AxisKey }[] = [
	{ label: 'Structural Quality', pct: '30%', key: 'structural' },
	{ label: 'Content Difficulty', pct: '25%', key: 'difficulty' },
	{ label: 'Diversity & Coverage', pct: '25%', key: 'diversity' },
	{ label: 'Annotation Reliability', pct: '20%', key: 'annotation' },
];

const AXIS_META: { key: AxisKey; name: string; description: string }[] = [
	{ key: 'structural', name: 'Structural Quality', description: 'Basic health of the dataset: size, balance, redundancy, and format consistency.' },
	{
		key: 'difficulty',
		name: 'Content Difficulty',
		description: 'How hard the task genuinely is on this data, and whether that difficulty is meaningful or just noise.',
	},
	{
		key: 'diversity',
		name: 'Diversity & Coverage',
		description: 'How much of the real world variation the dataset captures, versus narrow or repetitive samples.',
	},
	{ key: 'annotation', name: 'Annotation Reliability', description: 'How trustworthy the ground truth labels are.' },
];

const IMAGE_CLASSIFICATION_AXES: Record<AxisKey, { metrics: MetricDoc[]; axisFormula: string }> = {
	structural: {
		metrics: [
			{
				name: 'Class Balance',
				weight: '40% of axis score',
				how: 'We count examples per class and take the ratio of the largest class to the smallest. We also compute the normalized entropy of the class distribution, which gives a smoother read than a single ratio.',
				meaning: 'Highly imbalanced datasets are easy to get high accuracy on and hard to trust for the rare classes.',
				formula: 'S_balance = clamp(entropy × 10, 0, 10)',
				interpretation:
					'A score close to 0 means one or two classes dominate and the rest are barely represented. A score close to 10 means classes are close to equal size. Higher is better.',
			},
			{
				name: 'Redundancy',
				weight: '35% of axis score',
				how: "We hash every image to catch exact duplicates. For near duplicates, we embed images with a general purpose model and flag pairs with very high cosine similarity. Exact and near rates are added together so cleaning only one type can't inflate the score.",
				meaning: 'High duplication means the dataset is smaller and less varied than its file count suggests.',
				formula: 'S_redundancy = clamp(10 × (1 − (exact_rate + near_rate) / 0.20), 0, 10)',
				interpretation:
					'A score close to 10 means almost no duplicate images. A score close to 0 means a fifth or more of the dataset is duplicated. Higher is better.',
			},
			{
				name: 'Cross Split Contamination Penalty',
				badge: 'penalty',
				weight: 'Subtracted, up to 2 points',
				how: 'Same duplicate detection as above, but restricted to pairs where one copy lands in the train set and the other in validation or test.',
				meaning:
					'Samples that appear in more than one split let a model see the test answers during training, which inflates test accuracy without the model actually being better.',
				formula: 'P_cross = clamp((cross_dups + cross_near) × 100 / total_images, 0, 2)',
				interpretation:
					"This is a penalty, so lower is better and 0 is best. It grows as more images leak across splits and maxes out at 2 points once 2% or more of the dataset is contaminated this way. It's subtracted from the structural score rather than blended in, so it can't be hidden by a strong balance or resolution score.",
				isPenalty: true,
			},
			{
				name: 'Resolution Consistency',
				weight: '25% of axis score',
				how: 'We look at the spread of image width, height, aspect ratio, and file size across the whole dataset.',
				meaning: 'Tells us whether images come from a single clean source or a mix of cameras and phones.',
				formula: 'S_resolution = clamp(10 × (1 − area_cv), 0, 10)',
				interpretation:
					'A score close to 10 means images are highly uniform, usually a sign they came from one collection pipeline. A score close to 0 means resolutions vary wildly. Higher is generally better, though very low variation can also mean the images were all captured under one narrow setup.',
			},
		],
		axisFormula: 'Q_structural = clamp(0.40·S_balance + 0.35·S_redundancy + 0.25·S_resolution − P_cross, 0, 10)',
	},
	difficulty: {
		metrics: [
			{
				name: 'Feature Space Separability',
				weight: '40% of axis score',
				how: 'We embed images with a frozen, general purpose backbone that was never trained on this data, then score how well the ground truth labels separate into clusters in that embedding space.',
				meaning:
					'A model independent read on how separable the classes are. Low separability can mean the classes are genuinely hard to tell apart, or that some labels are wrong.',
				formula: 'S_separability = clamp((silhouette × 10 + clamp(10 − davies_bouldin × 3, 0, 10)) / 2, 0, 10)',
				interpretation:
					'A score close to 10 means the classes form tight, well separated clusters even to a model that has never seen this data. A score close to 0 means the classes overlap heavily. Higher is better.',
			},
			{
				name: 'Training Difficulty Balance',
				weight: '30% of axis score',
				how: "We train a reference model and track each example's prediction confidence and how much that confidence swings across training epochs. Plotting those two values sorts examples into easy, ambiguous, or hard to learn.",
				meaning: 'Shows whether a dataset is mostly trivial for a model to learn or has a genuine hard tail worth benchmarking against.',
				formula: 'S_cartography = clamp(10 × (1 − pct_hard / 50), 0, 10)',
				interpretation:
					'A score close to 0 means over half the dataset is hard for the reference model to learn confidently. A score close to 10 means almost everything is easy, which sounds good but can also mean the dataset is too trivial to be a useful benchmark. A mid to high score is usually the healthiest place to be, not a perfect 10.',
			},
			{
				name: 'Class Confusability',
				weight: '30% of axis score',
				how: 'Using the same reference model, we build a confusion matrix on held out data and pull out the class pairs the model mixes up most.',
				meaning: 'Shows which classes are visually hard to tell apart in this data, which helps prioritize where more examples are needed.',
				formula: 'S_confusability = clamp(accuracy × 10, 0, 10)',
				interpretation:
					"A score close to 10 means the reference model rarely confuses classes on held out data. A score close to 0 means it mixes them up constantly. Higher is better. The split seed is fixed and published, so this can't be inflated by choosing an easy test set.",
			},
		],
		axisFormula: 'Q_difficulty = 0.40·S_separability + 0.30·S_cartography + 0.30·S_confusability',
	},
	diversity: {
		metrics: [
			{
				name: 'Intra Class Visual Diversity',
				weight: '100% of axis score',
				how: "For each class, we embed every image and measure how far each one sits from that class's average embedding.",
				meaning:
					'Low diversity means a class is really just many near copies of the same shot, which can lead a model to memorize a narrow template instead of learning the real features.',
				formula: 'S_diversity = clamp(mean_diversity / 0.4 × 10, 0, 10)',
				interpretation:
					'A score close to 0 means images in a class barely differ from each other. A score close to 10 means wide visual variety within each class. Higher is better.',
			},
			{
				name: 'Metadata Coverage',
				weight: 'Not yet weighted',
				isPending: true,
				how: 'Where metadata exists, such as location, lighting, growth stage, or sensor type, we build frequency tables per class.',
				meaning:
					'Shows whether a class was only ever captured under one condition, which limits how well a model trained on it will generalize.',
				interpretation:
					"This metric doesn't produce a numeric score yet. It shows up as frequency tables on the benchmark card so it can be reviewed by eye.",
			},
		],
		axisFormula: 'Q_diversity = S_diversity',
	},
	annotation: {
		metrics: [
			{
				name: 'Label Noise Rate',
				weight: '100% of axis score',
				how: 'We train with k-fold cross validation to get an out of fold prediction for every example, then use confident learning methods (like cleanlab) to flag examples where the model consistently disagrees with the assigned label.',
				meaning: 'Gives an estimated share of mislabeled examples, plus a ranked list of the most likely mislabels for someone to review by hand.',
				formula: 'S_noise = clamp(10 × max(0, 1 − noise_rate / 0.10)^1.5, 0, 10)',
				interpretation:
					'A score close to 10 means very few labels are likely wrong. A score close to 0 means a large share are. The curve is steep near the bottom, so even a little estimated noise pulls the score down fast, and it hits 0 once estimated noise reaches 10%.',
			},
		],
		axisFormula: 'Q_annotation = S_noise',
	},
};

const PLACEHOLDER_NOTE = "Metric formulas for this task type are still being worked out. The four axes above apply, but the per metric scoring isn't published yet.";

const ANTI_GAMING_NOTES = [
	"Exact and near duplicate rates are added together for the redundancy score, so removing only exact duplicates while keeping near duplicates doesn't improve the score.",
	"Cross split contamination is penalized on its own and subtracted at the end, so it can't be masked by a strong balance or resolution score.",
	'Removing images to lower the duplicate rate also tends to lower diversity, since the removed images were adding variation. The two scores pull against each other.',
	'Separability uses both silhouette and Davies-Bouldin. Optimizing for one alone tends to push the other in the wrong direction.',
	"The label noise formula uses an exponent of 1.5, so small amounts of noise near the 10% cutoff barely move the score. There's little to gain from cleaning just enough to cross a boundary.",
	"The train and test split is drawn with a fixed, published seed, so confusability accuracy can't be inflated by choosing which examples land in the test set.",
];

const FIELD_REFS: { symbol: string; path: string }[] = [
	{ symbol: 'entropy', path: 'metrics.class_imbalance.normalized_entropy' },
	{ symbol: 'exact_rate', path: 'metrics.exact_duplicate.exact_duplicate_rate' },
	{ symbol: 'near_rate', path: 'metrics.near_duplicate.near_duplicate_rate' },
	{ symbol: 'cross_split_dups', path: 'metrics.exact_duplicate.cross_split_duplicates' },
	{ symbol: 'cross_split_near', path: 'metrics.near_duplicate.cross_split_near_duplicates' },
	{ symbol: 'total_images', path: 'metrics.exact_duplicate.total_images' },
	{ symbol: 'area_cv', path: 'metrics.resolution_consistency.area_cv' },
	{ symbol: 'silhouette', path: 'metrics.feature_separability.silhouette_score' },
	{ symbol: 'davies_bouldin', path: 'metrics.feature_separability.davies_bouldin_index' },
	{ symbol: 'mean_diversity', path: 'metrics.intra_class_diversity.mean_diversity' },
	{ symbol: 'pct_hard', path: 'metrics.dataset_cartography.pct_hard' },
	{ symbol: 'accuracy', path: 'metrics.class_confusability.accuracy' },
	{ symbol: 'noise_rate', path: 'metrics.label_noise.estimated_noise_rate' },
];

function nextFrame(): Promise<void> {
	return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

// html2canvas (unlike a real browser paint) can't parse oklch() at all — it throws and aborts the
// capture the instant it hits one, and CSS custom properties inherit, so setting only the handful
// this component's own styles reference isn't enough: getComputedStyle(document.body) reflects
// *every* --ifm-*/--agml-*/--docusaurus-* token defined on :root, oklch() or not, because they're
// all inherited whether this component uses them or not, and html2canvas's document-clone step
// touches all of them. This is every :root token that resolves (following var() aliases like
// --ifm-navbar-background-color: var(--agml-surface)) to an oklch() value — generated from
// src/css/custom.css's :root block, not hand-picked, so it can't silently drift out of sync — with
// each one pre-converted to the equivalent rgb()/rgba() string ahead of time (see oklchToRgb for
// the same conversion done at runtime, used here as a one-off script instead since these values
// are fixed). Always the light-mode set regardless of the current theme, matching .exportSnapshot.
const EXPORT_COLOR_TOKENS: [string, string][] = [
	['--ifm-color-primary', 'rgb(0, 120, 52)'],
	['--ifm-color-primary-dark', 'rgb(0, 105, 37)'],
	['--ifm-color-primary-darker', 'rgb(0, 96, 28)'],
	['--ifm-color-primary-darkest', 'rgb(0, 75, 12)'],
	['--ifm-color-primary-light', 'rgb(28, 135, 66)'],
	['--ifm-color-primary-lighter', 'rgb(49, 151, 81)'],
	['--ifm-color-primary-lightest', 'rgb(92, 181, 114)'],
	['--docusaurus-highlighted-code-line-bg', 'rgba(11, 14, 11, 0.08)'],
	['--agml-page-bg', 'rgb(248, 251, 248)'],
	['--agml-surface', 'rgb(241, 247, 241)'],
	['--agml-surface-strong', 'rgb(254, 255, 254)'],
	['--agml-surface-soft', 'rgb(240, 245, 240)'],
	['--agml-border', 'rgb(201, 208, 201)'],
	['--agml-border-strong', 'rgb(178, 186, 178)'],
	['--agml-shadow', '0 16px 32px rgba(0, 0, 0, 0.06)'],
	['--agml-shadow-strong', '0 24px 48px rgba(0, 0, 0, 0.09)'],
	['--agml-text', 'rgb(19, 24, 19)'],
	['--agml-muted', 'rgb(81, 87, 81)'],
	['--agml-accent-soft', 'rgb(201, 241, 208)'],
	['--agml-warning-text', 'rgb(201, 48, 45)'],
	['--agml-caution-text', 'rgb(175, 140, 0)'],
	['--agml-axis-difficulty', 'rgb(0, 101, 180)'],
	['--agml-axis-diversity', 'rgb(174, 64, 144)'],
	['--agml-modal-overlay', 'rgba(0, 0, 0, 0.3)'],
	['--agml-badge-classification-bg', 'rgb(177, 237, 178)'],
	['--agml-badge-classification-fg', 'rgb(0, 71, 0)'],
	['--agml-badge-detection-bg', 'rgb(162, 237, 216)'],
	['--agml-badge-detection-fg', 'rgb(0, 79, 57)'],
	['--agml-badge-segmentation-bg', 'rgb(221, 223, 170)'],
	['--agml-badge-segmentation-fg', 'rgb(66, 65, 0)'],
	['--agml-badge-other-bg', 'rgb(221, 227, 221)'],
	['--agml-badge-other-fg', 'rgb(68, 73, 68)'],
	['--agml-badge-vlm-bg', 'rgb(226, 207, 255)'],
	['--agml-badge-vlm-fg', 'rgb(73, 38, 118)'],
	['--agml-tag-bg', 'rgb(217, 229, 217)'],
	['--agml-tag-fg', 'rgb(51, 65, 51)'],
	['--ifm-navbar-background-color', 'rgb(241, 247, 241)'],
	['--ifm-footer-background-color', 'rgb(241, 247, 241)'],
	['--ifm-card-background-color', 'rgb(254, 255, 254)'],
	['--ifm-toc-background-color', 'rgb(241, 247, 241)'],
	['--ifm-toc-border-color', 'rgb(201, 208, 201)'],
];

function applyExportColors(el: HTMLElement) {
	for (const [token, value] of EXPORT_COLOR_TOKENS) el.style.setProperty(token, value);
}

function clearExportColors(el: HTMLElement) {
	for (const [token] of EXPORT_COLOR_TOKENS) el.style.removeProperty(token);
}

// html2canvas clones the whole document as part of its own pipeline, and — confirmed by testing,
// not just cautious guesswork — it does *not* correctly skip descendants of a `display: none`
// ancestor the way an actual browser paint does: hiding the rest of the page with CSS still left
// it walking into the Docusaurus site chrome and the dataset modal underneath, both full of this
// site's oklch() tokens, and throwing on the first one it hit. Actually detaching those nodes
// from the DOM (not just hiding them) is the only thing that reliably keeps html2canvas out of
// them. Returns a restore callback that puts everything back in its exact original order.
function detachOtherBodyChildren(keepEl: Node): () => void {
	const originalOrder = Array.from(document.body.childNodes);
	for (const node of originalOrder) {
		if (node !== keepEl) node.parentNode?.removeChild(node);
	}
	return () => {
		document.body.replaceChildren(...originalOrder);
	};
}

// PDF geometry, in points (72pt = 1in) — US Letter with a comfortable half-inch margin.
const PAGE_WIDTH_PT = 612;
const PAGE_HEIGHT_PT = 792;
const MARGIN_PT = 36;
const USABLE_WIDTH_PT = PAGE_WIDTH_PT - MARGIN_PT * 2;
const USABLE_HEIGHT_PT = PAGE_HEIGHT_PT - MARGIN_PT * 2;

// Cards, tiles, and formula boxes that should never be sliced in half across a page boundary —
// the same set the (still-present, Ctrl+P-only) @media print rules mark break-inside: avoid.
const UNBREAKABLE_SELECTOR = [
	'overallSection',
	'weightTile',
	'metricCard',
	'metricCardPenalty',
	'placeholderCard',
	'axisFormulaFooter',
	'fieldRefRow',
]
	.map((key) => `.${styles[key]}`)
	.join(',');

// A canvas screenshot has no concept of "don't split this element" the way print CSS does, so
// this re-derives it manually: read where each unbreakable block sits (in CSS px, relative to
// the panel's top) before rasterizing, then have the page-break search pull a cut point back to
// the top of whichever block it would otherwise land inside of.
function getUnbreakableRanges(panelEl: HTMLElement): { top: number; bottom: number }[] {
	const panelTop = panelEl.getBoundingClientRect().top;
	return Array.from(panelEl.querySelectorAll<HTMLElement>(UNBREAKABLE_SELECTOR)).map((el) => {
		const rect = el.getBoundingClientRect();
		return { top: rect.top - panelTop, bottom: rect.bottom - panelTop };
	});
}

// Greedily walks down the content in ~one-page steps, snapping each cut point back to the start
// of any unbreakable block it would otherwise fall in the middle of.
function computePageBreaks(totalHeight: number, pageHeight: number, ranges: { top: number; bottom: number }[]): number[] {
	const breaks = [0];
	let cursor = 0;
	while (cursor < totalHeight) {
		let candidate = cursor + pageHeight;
		if (candidate >= totalHeight) {
			breaks.push(totalHeight);
			break;
		}
		const collision = ranges.find((r) => candidate > r.top && candidate < r.bottom);
		if (collision) candidate = collision.top;
		// A single block taller than one page can't be avoided — fall back to a hard cut so the
		// loop still makes forward progress instead of spinning forever.
		if (candidate <= cursor) candidate = cursor + pageHeight;
		breaks.push(candidate);
		cursor = candidate;
	}
	// The panel's own bottom padding/border trails past the last real content by a little, which
	// can leave a nearly-blank final "page" a few px tall on its own — fold it into the previous
	// page instead of shipping a page whose only content is some rounded corner.
	while (breaks.length > 2 && breaks[breaks.length - 1] - breaks[breaks.length - 2] < 24) {
		breaks.splice(breaks.length - 2, 1);
	}
	return breaks;
}

function buildAxisGroups(taskType: TaskType): AxisDoc[] {
	const data = taskType === 'Image Classification' ? IMAGE_CLASSIFICATION_AXES : null;
	return AXIS_META.map((meta) => ({
		...meta,
		metrics: data ? data[meta.key].metrics : [],
		axisFormula: data ? data[meta.key].axisFormula : '',
	}));
}

function MetricCard({ metric, axisClass }: { metric: MetricDoc; axisClass: string }) {
	return (
		<div className={`${styles.metricCard} ${metric.isPenalty ? styles.metricCardPenalty : axisClass}`}>
			<div className={styles.metricCardHeader}>
				<h4 className={styles.metricName}>{metric.name}</h4>
				<div className={styles.badgeGroup}>
					{metric.badge && <span className={styles.penaltyBadge}>{metric.badge}</span>}
					{metric.weight && <span className={styles.weightTag}>{metric.weight}</span>}
				</div>
			</div>

			<div>
				<p className={styles.fieldLabel}>How it&rsquo;s calculated</p>
				<p className={styles.fieldText}>{metric.how}</p>
			</div>

			{metric.formula && <div className={styles.formulaBox}>{metric.formula}</div>}

			<div>
				<p className={styles.fieldLabel}>What it means</p>
				<p className={styles.fieldText}>{metric.meaning}</p>
			</div>

			{metric.isPending ? (
				<p className={styles.pendingNote}>{metric.interpretation}</p>
			) : (
				<div>
					<p className={styles.fieldLabel}>Reading the score</p>
					<p className={styles.fieldText}>{metric.interpretation}</p>
				</div>
			)}
		</div>
	);
}

const AXIS_CLASS: Record<AxisKey, string> = {
	structural: 'axisStructural',
	difficulty: 'axisDifficulty',
	diversity: 'axisDiversity',
	annotation: 'axisAnnotation',
};

export function ScoringMethodologyModal({
	open,
	taskType = 'Image Classification',
	onClose,
}: {
	open: boolean;
	taskType?: TaskType;
	onClose: () => void;
}) {
	const [activeTab, setActiveTab] = useState<TaskType>(taskType);
	const [isExporting, setIsExporting] = useState(false);
	const fieldRefDetailsEl = useRef<HTMLDetailsElement>(null);
	const panelEl = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (open) setActiveTab(taskType);
	}, [open, taskType]);

	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onClose();
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [open, onClose]);

	if (!open) return null;

	// Downloads a PDF directly — no print dialog, no "choose a destination" step. Built with
	// html2canvas + jsPDF instead of the browser's native print-to-PDF specifically so the file
	// lands in Downloads on click; the trade-off is a rasterized page image rather than
	// selectable text, so the capture width/scale below are tuned to still read crisply.
	const handleExportClick = async () => {
		if (isExporting) return;
		setIsExporting(true);
		try {
			// Only the active tab's content is ever in the DOM — exporting "the entire reference"
			// while e.g. Object Detection is selected would otherwise capture just its placeholder.
			if (activeTab !== 'Image Classification') {
				setActiveTab('Image Classification');
				await nextFrame();
				await nextFrame();
			}

			const detailsEl = fieldRefDetailsEl.current;
			const wasDetailsOpen = detailsEl?.open ?? false;
			if (detailsEl) detailsEl.open = true;

			const panel = panelEl.current;
			if (!panel) return;

			const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);

			// 1.5 is a compromise: high enough to still look crisp when zoomed in on a screen,
			// low enough (combined with JPEG below) to keep the file a few MB instead of tens of —
			// scale 2 with lossless PNG produced a ~55MB download for this document.
			const scale = 1.5;
			let canvas: HTMLCanvasElement;
			let ranges: { top: number; bottom: number }[];
			let panelWidthPx: number;
			const restoreBody = detachOtherBodyChildren(panel.parentElement ?? panel);
			try {
				// Forces the light palette regardless of the current theme (a dark capture would
				// either waste ink if someone prints it later or, worse, get its background silently
				// dropped while the text stays light), removes the on-screen height cap so nothing is
				// clipped, and fixes the width so the export always uses the wide desktop layout —
				// otherwise a narrow browser window would export the mobile single-column layout.
				panel.classList.add(styles.exportSnapshot);
				// <html>, not <body> or just the panel: custom-property var() substitution resolves
				// per element, and
				// Infima's own internal tokens (--ifm-link-color, --docusaurus-progress-bar-color,
				// pagination/tabs/menu active-colors, etc. — none of them mine to enumerate) are
				// declared as var(--ifm-color-primary) on the same html[data-theme] rule that sets
				// --ifm-color-primary itself. Overriding on body would only reach body's own
				// inherited copy of --ifm-color-primary, too late for those aliases — they'd already
				// have resolved against html's oklch() value. Overriding on html instead means any
				// var() reference declared alongside it picks up this override too, transitively.
				applyExportColors(document.documentElement);
				await nextFrame();
				await nextFrame();

				ranges = getUnbreakableRanges(panel);
				panelWidthPx = panel.getBoundingClientRect().width;
				canvas = await html2canvas(panel, { backgroundColor: '#ffffff', scale, useCORS: true });
			} finally {
				// Runs even if html2canvas throws (it does, on anything it can't parse) — otherwise a
				// failed export would leave the modal stuck showing the light-forced snapshot state.
				restoreBody();
				panel.classList.remove(styles.exportSnapshot);
				clearExportColors(document.documentElement);
				if (detailsEl) detailsEl.open = wasDetailsOpen;
			}

			const ptPerPx = USABLE_WIDTH_PT / panelWidthPx;
			const pageHeightPx = USABLE_HEIGHT_PT / ptPerPx;
			const totalHeightPx = canvas.height / scale;
			const breaks = computePageBreaks(totalHeightPx, pageHeightPx, ranges);

			const doc = new jsPDF({ unit: 'pt', format: 'letter' });
			const sliceCanvas = document.createElement('canvas');
			const sliceCtx = sliceCanvas.getContext('2d');
			sliceCanvas.width = canvas.width;

			for (let i = 0; i < breaks.length - 1; i += 1) {
				const sliceTopPx = breaks[i];
				const sliceHeightPx = breaks[i + 1] - sliceTopPx;
				if (sliceHeightPx <= 0) continue;

				sliceCanvas.height = sliceHeightPx * scale;
				sliceCtx?.clearRect(0, 0, sliceCanvas.width, sliceCanvas.height);
				sliceCtx?.drawImage(
					canvas,
					0,
					sliceTopPx * scale,
					canvas.width,
					sliceHeightPx * scale,
					0,
					0,
					canvas.width,
					sliceHeightPx * scale,
				);

				if (i > 0) doc.addPage();
				// JPEG over PNG for the same reason as the reduced scale above — this is a rasterized
				// capture either way, so there's no selectable-text quality to lose, and at 0.92
				// quality the compression artifacts aren't visible while the file shrinks drastically
				// compared to lossless PNG at this resolution.
				doc.addImage(sliceCanvas.toDataURL('image/jpeg', 0.92), 'JPEG', MARGIN_PT, MARGIN_PT, USABLE_WIDTH_PT, sliceHeightPx * ptPerPx);
			}

			doc.save('AgML-Scoring-Methodology.pdf');
		} finally {
			setIsExporting(false);
		}
	};

	const axisGroups = buildAxisGroups(activeTab);

	// Portaled to the document body — this modal can be opened from inside the dataset modal's
	// flip-card face, and that face's `transform`/`perspective` (for the 3D flip) creates a new
	// containing block for any `position: fixed` descendant, which would otherwise center this
	// backdrop inside that tall transformed box instead of the actual viewport.
	return createPortal(
		// The extra, unhashed "print-export-root" class is a stable hook for the global print
		// stylesheet (src/css/custom.css) — a CSS Modules class name can't be targeted from
		// outside its own file, and hiding every *other* piece of the page during print (the
		// Docusaurus site chrome, the dataset modal underneath) has to happen from there.
		<div className={`${styles.backdrop} print-export-root`} role="presentation" onClick={onClose}>
			<div
				ref={panelEl}
				className={styles.panel}
				role="dialog"
				aria-modal="true"
				aria-labelledby="scoring-methodology-title"
				onClick={(event) => event.stopPropagation()}
			>
				<div className={styles.header}>
					<div>
						<p className={styles.eyebrow}>Reference</p>
						<h2 id="scoring-methodology-title" className={styles.title}>
							Scoring Methodology
						</h2>
						<p className={styles.subtitle}>
							How overall and per axis quality scores are computed from each run&rsquo;s report.json. This is a static
							reference, not live data.
						</p>
					</div>
					<div className={styles.headerActions}>
						<button type="button" className={styles.exportButton} onClick={handleExportClick} disabled={isExporting}>
							{isExporting ? 'Preparing PDF…' : '⬇ Export to PDF'}
						</button>
						<button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close scoring methodology">
							×
						</button>
					</div>
				</div>

				<div className={styles.tabRow}>
					{TASK_TYPES.map((label) => (
						<button
							key={label}
							type="button"
							className={`${styles.tab} ${activeTab === label ? styles.tabActive : ''}`}
							onClick={() => setActiveTab(label)}
						>
							{label}
						</button>
					))}
				</div>

				<div className={styles.overallSection}>
					<h3 className={styles.sectionTitle}>Overall score</h3>
					<p className={styles.bodyText}>The overall score is a weighted average of the four axis scores below.</p>
					<div className={styles.weightRow}>
						{AXIS_WEIGHTS.map((w) => (
							<div key={w.key} className={`${styles.weightTile} ${styles[AXIS_CLASS[w.key]]}`}>
								<span className={styles.weightPct}>{w.pct}</span>
								<span className={styles.weightLabel}>{w.label}</span>
							</div>
						))}
					</div>
					<div className={styles.formulaBox}>
						Q_overall = 0.30·Q_structural + 0.25·Q_difficulty + 0.25·Q_diversity + 0.20·Q_annotation
					</div>
					<p className={styles.bodyText}>
						If an entire axis can&rsquo;t be computed for a dataset, its weight is split evenly across the axes that
						are available, so the overall score always adds up to a full weighted average.
					</p>
					<p className={styles.bodyText}>
						If just one metric inside an axis is missing rather than the whole axis, that metric&rsquo;s weight is
						split across the other metrics in the same axis instead.
					</p>
					<div className={styles.thresholdLegend}>
						<span className={styles.thresholdItem}>
							<span className={`${styles.thresholdDot} ${styles.thresholdGood}`} />
							0.75 and up is good
						</span>
						<span className={styles.thresholdItem}>
							<span className={`${styles.thresholdDot} ${styles.thresholdFair}`} />
							0.50 to 0.75 is fair
						</span>
						<span className={styles.thresholdItem}>
							<span className={`${styles.thresholdDot} ${styles.thresholdPoor}`} />
							below 0.50 needs attention
						</span>
					</div>
					<p className={styles.scaleNote}>
						Formulas below compute on a 0 to 10 internal scale. The dataset card displays each score normalized to 0
						to 1 by dividing by 10. The thresholds above are in those app units.
					</p>
				</div>

				{axisGroups.map((axis) => (
					<div key={axis.key} className={styles.axisSection}>
						<h3 className={`${styles.axisTitle} ${styles[AXIS_CLASS[axis.key]]}`}>{axis.name}</h3>
						<p className={styles.bodyText}>{axis.description}</p>

						{axis.metrics.length > 0 ? (
							<div className={styles.metricGrid}>
								{axis.metrics.map((metric) => (
									<MetricCard key={metric.name} metric={metric} axisClass={styles[AXIS_CLASS[axis.key]]} />
								))}
							</div>
						) : (
							<div className={styles.placeholderCard}>
								<p className={styles.placeholderText}>{PLACEHOLDER_NOTE}</p>
							</div>
						)}

						{axis.axisFormula && (
							<div className={styles.axisFormulaFooter}>
								<p className={styles.fieldLabel}>Axis score</p>
								<div className={`${styles.formulaBox} ${styles.axisFormulaBox} ${styles[AXIS_CLASS[axis.key]]}`}>
									{axis.axisFormula}
								</div>
							</div>
						)}
					</div>
				))}

				<div className={styles.footerSection}>
					<h3 className={styles.sectionTitle}>How the formulas resist gaming</h3>
					<div className={styles.antiGamingList}>
						{ANTI_GAMING_NOTES.map((note) => (
							<div key={note} className={styles.antiGamingItem}>
								<span className={styles.antiGamingMarker} aria-hidden="true">
									▸
								</span>
								<p className={styles.antiGamingText}>{note}</p>
							</div>
						))}
					</div>
					<details ref={fieldRefDetailsEl} className={styles.fieldRefDetails}>
						<summary className={styles.fieldRefSummary}>JSON field reference</summary>
						<div className={styles.fieldRefGrid}>
							{FIELD_REFS.map((f) => (
								<div key={f.symbol} className={styles.fieldRefRow}>
									<span className={styles.fieldRefSymbol}>{f.symbol}</span>
									<span className={styles.fieldRefPath}>{f.path}</span>
								</div>
							))}
						</div>
					</details>
				</div>
			</div>
		</div>,
		document.body,
	);
}

export default ScoringMethodologyModal;
