/*
	Benchmark face of the dataset modal: a score header (overall tick ring + one arc gauge per
	axis), a compact score strip that sticks to the top while the metric sections scroll, and
	one section per scoring axis holding that axis's metric cards.

	Every card that lists per-class values has two layouts: up to MANY_CLASSES classes it shows
	them all; past that it switches to an overview + scroll list, lowest / highest TOP_N with a
	"Show all" toggle, or a matrix capped to the CONFUSION_CAP lowest-accuracy classes.
*/
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { toTitleCase } from '../lib/datasets';
import type {
	BenchmarkData,
	ClassConfusabilityMetrics,
	ClassImbalanceMetrics,
	DatasetCartographyMetrics,
	ExactDuplicateMetrics,
	FeatureSeparabilityMetrics,
	IntraClassDiversityMetrics,
	LabelNoiseMetrics,
	NearDuplicateMetrics,
	ReproducibilityInfo,
	ResolutionConsistencyMetrics,
} from '../lib/benchmarks';
import { computeScores, type AxisScores } from '../lib/scoring';
import { resolveMatrixOrder } from '../lib/confusionOrder';
import styles from './BenchmarkView.module.css';

// Past this many classes, per-class lists switch to their compact many-class layout.
const MANY_CLASSES = 8;
// Lowest / highest N shown by per-class lists in the many-class layout.
const TOP_N = 5;
// Above this many classes the confusion matrix keeps only the lowest-accuracy classes.
const CONFUSION_CAP = 12;
// Off-diagonal matrix cells at or above this rate get a warning outline.
const CONFUSION_FLAG_MIN = 0.1;
// Intra-class diversity earns the full axis score at this mean distance (scoring.ts).
const DIVERSITY_FULL_SCORE = 0.4;
// Length of the score header's fill + count-up entrance.
const ENTRANCE_MS = 1900;

// ---------------------------------------------------------------------------------------------
// Shared helpers

type Tier = 'good' | 'mid' | 'poor' | 'na';

function scoreTier(value: number | null): Tier {
	if (value == null || Number.isNaN(value)) return 'na';
	if (value >= 7.5) return 'good';
	if (value >= 5) return 'mid';
	return 'poor';
}

const TIER_LABEL: Record<Tier, string> = { good: 'Strong', mid: 'Fair', poor: 'Weak', na: 'N/A' };

function easeOutCubic(x: number): number {
	const t = Math.min(1, Math.max(0, x));
	return 1 - Math.pow(1 - t, 3);
}

function clamp(x: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, x));
}

function pct(value: number, digits = 1): string {
	return `${(value * 100).toFixed(digits)}%`;
}

function shortInterpretation(text: string | undefined): string {
	return (text ?? '').split(' — ')[0];
}

// Elapsed ms since `active` last turned true, re-rendering every frame until ENTRANCE_MS.
// Reduced-motion users get the end state immediately.
function useEntrance(active: boolean): number {
	const [elapsed, setElapsed] = useState(0);
	useEffect(() => {
		if (!active) {
			setElapsed(0);
			return;
		}
		if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
			setElapsed(ENTRANCE_MS);
			return;
		}
		let raf = 0;
		const start = performance.now();
		const step = (now: number) => {
			const el = now - start;
			setElapsed(el);
			if (el < ENTRANCE_MS) raf = requestAnimationFrame(step);
		};
		raf = requestAnimationFrame(step);
		return () => cancelAnimationFrame(raf);
	}, [active]);
	return elapsed;
}

// Keeps an absolutely positioned bubble inside the dialog's content box. It's centered on its
// trigger by CSS (translateX(-50%)); near the modal edges that pushes it out, so measure once
// it's displayed and shift it back in.
function useClampedBubble() {
	const ref = useRef<HTMLSpanElement>(null);
	const clampNow = () => {
		const bubble = ref.current;
		if (!bubble) return;
		bubble.style.transform = '';
		const boundary = bubble.closest('[role="dialog"]') as HTMLElement | null;
		if (!boundary) return;
		const bounds = boundary.getBoundingClientRect();
		const cs = getComputedStyle(boundary);
		const left = bounds.left + boundary.clientLeft + (parseFloat(cs.paddingLeft) || 0) + 4;
		const right = bounds.left + boundary.clientLeft + boundary.clientWidth - (parseFloat(cs.paddingRight) || 0) - 4;
		const rect = bubble.getBoundingClientRect();
		let dx = 0;
		if (rect.right > right) dx = right - rect.right;
		if (rect.left + dx < left) dx = left - rect.left;
		if (dx) bubble.style.transform = `translateX(calc(-50% + ${dx}px))`;
	};
	// Deferred a frame so :hover / :focus has switched the bubble to display: block.
	const schedule = () => requestAnimationFrame(clampNow);
	return { ref, schedule };
}

function Tip({ label, lead, text }: { label: string; lead?: string; text: string }) {
	const id = useId();
	const { ref, schedule } = useClampedBubble();
	return (
		<button type="button" className={styles.tip} aria-label={`About ${label}`} aria-describedby={id} onMouseEnter={schedule} onFocus={schedule}>
			<span aria-hidden="true">i</span>
			<span ref={ref} id={id} role="tooltip" className={styles.bubble}>
				{lead && <b>{lead} </b>}
				{text}
			</span>
		</button>
	);
}

function CardHeader({ title, info, badge }: { title: string; info: string; badge?: string }) {
	return (
		<div className={styles.cardHeader}>
			<div className={styles.cardTitle}>
				<h4 className={styles.cardTitleText}>{title}</h4>
				<Tip label={title} text={info} />
			</div>
			{badge && <span className={styles.tag}>{badge}</span>}
		</div>
	);
}

function Label({ children, info, infoLead, name }: { children: ReactNode; info?: string; infoLead?: string; name?: string }) {
	return (
		<span className={styles.label}>
			{children}
			{info && <Tip label={name ?? String(children)} lead={infoLead} text={info} />}
		</span>
	);
}

function Tile({ label, value, caption, info, infoLead, tone }: { label: string; value: string; caption?: string; info?: string; infoLead?: string; tone?: Tier }) {
	return (
		<div className={styles.tile}>
			<Label info={info} infoLead={infoLead} name={label}>
				{label}
			</Label>
			<span className={styles.tileValue} data-tone={tone}>
				{value}
			</span>
			{caption && <span className={styles.tileCaption}>{caption}</span>}
		</div>
	);
}

function SkippedCard({ title, reason }: { title: string; reason?: string }) {
	return (
		<div className={styles.card}>
			<div className={styles.cardHeader}>
				<div className={styles.cardTitle}>
					<h4 className={styles.cardTitleText}>{title}</h4>
				</div>
			</div>
			<p className={styles.skipped}>Skipped: {reason || 'not computed for this run.'}</p>
		</div>
	);
}

function ShowAllButton({ count, expanded, onToggle }: { count: number; expanded: boolean; onToggle: () => void }) {
	return (
		<button type="button" className={styles.moreButton} onClick={onToggle} aria-expanded={expanded}>
			{expanded ? 'Show fewer' : `Show all ${count} classes`}
		</button>
	);
}

// Lowest TOP_N and highest TOP_N from a list already sorted ascending by value.
function lowHigh<T>(sortedAsc: T[]): { low: T[]; high: T[] } {
	return { low: sortedAsc.slice(0, TOP_N), high: sortedAsc.slice(-TOP_N).reverse() };
}

// ---------------------------------------------------------------------------------------------
// Score header

const AXIS_ITEMS: { key: keyof Omit<AxisScores, 'overall'>; label: string; short: string; anchor: string }[] = [
	{ key: 'structural', label: 'Structural Quality', short: 'Structural', anchor: 'structural' },
	{ key: 'difficulty', label: 'Content Difficulty', short: 'Difficulty', anchor: 'difficulty' },
	{ key: 'diversity', label: 'Diversity & Coverage', short: 'Diversity', anchor: 'diversity' },
	{ key: 'annotation', label: 'Annotation Reliability', short: 'Annotation', anchor: 'annotation' },
];

function axisDrivers(benchmark: BenchmarkData): Record<(typeof AXIS_ITEMS)[number]['key'], string> {
	const m = benchmark.metrics;
	// Near duplicates include exact copies, so take the larger set rather than adding the two.
	const crossSplit = Math.max(m.exact_duplicate?.cross_split_duplicates ?? 0, m.near_duplicate?.cross_split_near_duplicates ?? 0);
	const structural = m.class_imbalance
		? `${m.class_imbalance.normalized_entropy >= 0.9 ? 'Balanced classes' : 'Uneven classes'}; ${
				crossSplit > 0 ? `${crossSplit.toLocaleString()} duplicates across train/test` : 'no cross-split duplicates'
		  }`
		: 'Not computed for this run';
	const sep = m.feature_separability && !m.feature_separability.skipped ? m.feature_separability : null;
	const interp = sep ? shortInterpretation(sep.silhouette_interpretation) : '';
	const difficulty = sep ? `${interp.charAt(0).toUpperCase()}${interp.slice(1)} between classes` : 'Not computed for this run';
	const div = m.intra_class_diversity;
	const diversity = div
		? div.mean_diversity >= DIVERSITY_FULL_SCORE
			? 'High visual variety within every class'
			: div.mean_diversity >= DIVERSITY_FULL_SCORE / 2
			? 'Moderate variety within classes'
			: 'Low variety; classes may be repetitive'
		: 'Not computed for this run';
	const noise = m.label_noise && !m.label_noise.skipped ? m.label_noise : null;
	const annotation = noise ? `${pct(noise.estimated_noise_rate)} of labels estimated noisy` : 'Not computed for this run';
	return { structural, difficulty, diversity, annotation };
}

function tickRing(value: number | null, e: number) {
	const c = 100;
	const sw = 14;
	const r = c - sw / 2 - 10;
	const C = 2 * Math.PI * r;
	const f = value == null ? 0 : (value / 10) * e;
	const a = ((-90 + 360 * f) * Math.PI) / 180;
	const n = 60;
	const lit = Math.round(n * f);
	const r1 = r - sw / 2 - 7;
	const r2 = r1 - 6;
	let on = '';
	let off = '';
	for (let i = 0; i < n; i++) {
		const t = ((-90 + (360 * i) / n) * Math.PI) / 180;
		const seg = `M${(c + r1 * Math.cos(t)).toFixed(1)} ${(c + r1 * Math.sin(t)).toFixed(1)}L${(c + r2 * Math.cos(t)).toFixed(1)} ${(c + r2 * Math.sin(t)).toFixed(1)}`;
		if (i < lit) on += seg;
		else off += seg;
	}
	return { r, C, offset: C * (1 - f), dx: c + r * Math.cos(a), dy: c + r * Math.sin(a), on, off };
}

function OverallCard({ value, elapsed, driver }: { value: number | null; elapsed: number; driver: string }) {
	const e = easeOutCubic(elapsed / 1400);
	const tier = scoreTier(value);
	const ring = tickRing(value, e);
	return (
		<div className={`${styles.scoreCard} ${styles.scoreCardOverall}`} data-tier={tier}>
			<span className={styles.scoreCardLabel}>Overall</span>
			<div className={styles.overallRing}>
				<svg width="200" height="200" viewBox="0 0 200 200" aria-hidden="true">
					<circle cx="100" cy="100" r="97" className={styles.orbit} />
					<path d={ring.off || 'M0 0'} className={styles.tickOff} />
					<path d={ring.on || 'M0 0'} className={styles.tickOn} />
					<circle cx="100" cy="100" r={ring.r} className={styles.ringTrack} strokeWidth="14" />
					{value != null && (
						<>
							<circle
								cx="100"
								cy="100"
								r={ring.r}
								className={styles.ringValue}
								strokeWidth="14"
								strokeDasharray={ring.C}
								strokeDashoffset={ring.offset}
								transform="rotate(-90 100 100)"
							/>
							<circle cx={ring.dx} cy={ring.dy} r="9" className={styles.ringDot} strokeWidth="3.5" />
						</>
					)}
				</svg>
				<div className={styles.ringCenter}>
					<span className={styles.overallValue}>{value == null ? 'N/A' : (value * e).toFixed(1)}</span>
					<span className={styles.ringUnit}>out of 10</span>
				</div>
			</div>
			<span className={styles.tierChip}>{TIER_LABEL[tier]}</span>
			<span className={styles.scoreDriver}>{driver}</span>
		</div>
	);
}

function gaugeGeometry(value: number | null, e: number) {
	const c = 70;
	const sw = 11;
	const r = c - sw / 2 - 12;
	const rz = r + sw / 2 + 6;
	const C = 2 * Math.PI * r;
	const L = 0.75 * C;
	const Cz = 2 * Math.PI * rz;
	const Lz = 0.75 * Cz;
	const f = value == null ? 0 : (value / 10) * e;
	const a = ((135 + 270 * f) * Math.PI) / 180;
	const gap = 1.5;
	return {
		r,
		rz,
		track: `${L} ${C}`,
		val: `${L * f} ${C}`,
		zPoor: `${Lz * 0.5 - gap} ${Cz}`,
		zMid: `${Lz * 0.25 - gap} ${Cz}`,
		zMidOff: -Lz * 0.5,
		zGood: `${Lz * 0.25} ${Cz}`,
		zGoodOff: -Lz * 0.75,
		dx: c + r * Math.cos(a),
		dy: c + r * Math.sin(a),
	};
}

function AxisGaugeCard({ label, value, driver, elapsed, index }: { label: string; value: number | null; driver: string; elapsed: number; index: number }) {
	const e = easeOutCubic((elapsed - 150 - index * 110) / 1300);
	const tier = scoreTier(value);
	const g = gaugeGeometry(value, e);
	return (
		<div className={styles.scoreCard} data-tier={tier}>
			<span className={styles.scoreCardLabel}>{label}</span>
			<div className={styles.gauge}>
				<svg width="140" height="140" viewBox="0 0 140 140" aria-hidden="true">
					<circle cx="70" cy="70" r={g.rz} className={styles.zonePoor} strokeDasharray={g.zPoor} transform="rotate(135 70 70)" />
					<circle cx="70" cy="70" r={g.rz} className={styles.zoneMid} strokeDasharray={g.zMid} strokeDashoffset={g.zMidOff} transform="rotate(135 70 70)" />
					<circle cx="70" cy="70" r={g.rz} className={styles.zoneGood} strokeDasharray={g.zGood} strokeDashoffset={g.zGoodOff} transform="rotate(135 70 70)" />
					<circle cx="70" cy="70" r={g.r} className={styles.ringTrack} strokeWidth="11" strokeLinecap="round" strokeDasharray={g.track} transform="rotate(135 70 70)" />
					{value != null && (
						<>
							<circle cx="70" cy="70" r={g.r} className={styles.ringValue} strokeWidth="11" strokeDasharray={g.val} transform="rotate(135 70 70)" />
							<circle cx={g.dx} cy={g.dy} r="7" className={styles.ringDot} strokeWidth="3" />
						</>
					)}
				</svg>
				<div className={styles.gaugeCenter}>
					<span className={styles.gaugeValue}>{value == null ? 'N/A' : (value * e).toFixed(1)}</span>
					<span className={styles.ringUnit}>/ 10</span>
				</div>
				<span className={styles.gaugeMin}>0</span>
				<span className={styles.gaugeMax}>10</span>
			</div>
			<span className={styles.tierChip}>{TIER_LABEL[tier]}</span>
			<span className={styles.scoreDriver}>{driver}</span>
		</div>
	);
}

function MiniRing({ value }: { value: number | null }) {
	const C = 2 * Math.PI * 15;
	return (
		<svg width="38" height="38" viewBox="0 0 38 38" aria-hidden="true" className={styles.miniRing}>
			<circle cx="19" cy="19" r="15" className={styles.ringTrack} strokeWidth="4" />
			{value != null && (
				<circle
					cx="19"
					cy="19"
					r="15"
					className={styles.ringValue}
					strokeWidth="4"
					strokeDasharray={C}
					strokeDashoffset={C * (1 - value / 10)}
					transform="rotate(-90 19 19)"
				/>
			)}
		</svg>
	);
}

// ---------------------------------------------------------------------------------------------
// Structural Quality cards

function ClassImbalanceCard({ d }: { d: ClassImbalanceMetrics }) {
	const [sort, setSort] = useState<'largest' | 'smallest' | 'az'>('largest');
	const entries = useMemo(() => Object.entries(d.counts).sort((a, b) => b[1] - a[1]), [d.counts]);
	const n = entries.length;
	const total = entries.reduce((sum, [, v]) => sum + v, 0) || d.total_train_examples;
	const equal = n ? total / n : 0;
	const max = entries[0]?.[1] ?? 1;
	const min = entries[n - 1]?.[1] ?? 0;
	const tickPct = clamp((equal / max) * 100, 0, 100);
	const many = n > MANY_CLASSES;
	const below = entries.filter(([, v]) => v < equal).length;
	const sorted = useMemo(() => {
		if (sort === 'smallest') return [...entries].reverse();
		if (sort === 'az') return [...entries].sort((a, b) => a[0].localeCompare(b[0]));
		return entries;
	}, [entries, sort]);

	const row = ([name, value]: [string, number]) => (
		<div key={name} className={many ? styles.imbRowCompact : styles.imbRow}>
			<span className={styles.trunc} title={toTitleCase(name)}>
				{toTitleCase(name)}
			</span>
			<span className={styles.imbTrack}>
				<span className={styles.imbFill} data-below={value < equal || undefined} style={{ width: `${(value / max) * 100}%` }} />
				<span className={styles.equalTick} style={{ left: `${tickPct}%` }} />
			</span>
			<span className={styles.mono}>{value.toLocaleString()}</span>
		</div>
	);

	return (
		<div className={styles.card}>
			<CardHeader
				title="Class Imbalance"
				info="How evenly images are spread across classes. Big gaps bias a model toward the larger classes."
				badge={`${n} classes · ${d.total_train_examples.toLocaleString()} train`}
			/>
			{many ? (
				<>
					<div className={styles.overviewWrap}>
						<span className={styles.label}>Overview · largest to smallest</span>
						<div className={styles.overview}>
							{entries.map(([name, value]) => (
								<span
									key={name}
									className={styles.overviewCol}
									data-below={value < equal || undefined}
									style={{ height: `${(value / max) * 100}%` }}
									title={`${toTitleCase(name)}: ${value}`}
								/>
							))}
							<span className={styles.overviewEqual} style={{ bottom: `${tickPct}%` }} />
						</div>
					</div>
					<div className={styles.sortRow}>
						<div role="group" aria-label="Sort classes" className={styles.pills}>
							{(['largest', 'smallest', 'az'] as const).map((key) => (
								<button key={key} type="button" className={styles.pill} aria-pressed={sort === key} onClick={() => setSort(key)}>
									{key === 'largest' ? 'Largest' : key === 'smallest' ? 'Smallest' : 'A–Z'}
								</button>
							))}
						</div>
						<span className={styles.label}>scroll · {n}</span>
					</div>
					<div className={styles.scrollList}>{sorted.map(row)}</div>
				</>
			) : (
				<div className={styles.stack}>{entries.map(row)}</div>
			)}
			<div className={styles.legend}>
				<span>
					<i className={styles.swatch} data-tone="good" />
					At or above equal share
				</span>
				<span>
					<i className={styles.swatch} data-tone="mid" />
					Below equal share{many ? ` · ${below} classes` : ''}
				</span>
				<span>
					<i className={styles.tickSwatch} />
					Equal share · {Math.round(equal).toLocaleString()}
				</span>
			</div>
			<div className={`${styles.tileGrid} ${styles.divided}`}>
				<Tile
					label="Norm. entropy"
					value={d.normalized_entropy.toFixed(2)}
					caption="1 = perfectly even"
					info="1 means every class has an equal share."
					infoLead="From 0 to 1."
				/>
				<Tile
					label="Imbalance ratio"
					value={`${d.imbalance_ratio.toFixed(d.imbalance_ratio >= 10 ? 1 : 2)}×`}
					caption={many ? `${max.toLocaleString()} ÷ ${min.toLocaleString()} (largest ÷ smallest)` : 'largest ÷ smallest'}
					info="Largest class ÷ smallest class. 1× is perfectly balanced."
					tone={d.imbalance_ratio > 5 ? 'poor' : undefined}
				/>
			</div>
		</div>
	);
}

function DuplicateCard({ exact, near }: { exact?: ExactDuplicateMetrics; near?: NearDuplicateMetrics }) {
	const total = exact?.total_images ?? near?.total_images ?? 0;
	const exactRate = exact?.exact_duplicate_rate ?? 0;
	const nearRate = near?.near_duplicate_rate ?? 0;
	// Two concentric rings on a 0–100% scale: near (which already includes exact copies) outside,
	// exact inside. Neither is added to the other.
	const outer = 2 * Math.PI * 45;
	const inner = 2 * Math.PI * 33;
	const rate = (r: number) => pct(r, r < 0.1 ? 2 : 1);
	const rows = [
		exact && { kind: 'exact', name: 'Exact', groups: exact.duplicate_groups, cross: exact.cross_split_duplicates },
		near && { kind: 'near', name: 'Near', groups: near.near_duplicate_groups, cross: near.cross_split_near_duplicates },
	].filter(Boolean) as { kind: string; name: string; groups: number; cross: number }[];
	return (
		<div className={styles.card}>
			<CardHeader
				title="Duplicate Detection"
				info="Repeated images make the dataset look bigger than it is, and can leak from train into test."
				badge={total ? `${total.toLocaleString()} images` : undefined}
			/>
			<div className={styles.ringRow}>
				<div className={styles.donut104}>
					<svg width="104" height="104" viewBox="0 0 104 104" aria-hidden="true">
						<circle cx="52" cy="52" r="45" className={styles.dupTrack} />
						<circle cx="52" cy="52" r="45" className={styles.dupSeg} data-kind="near" strokeDasharray={`${clamp(nearRate, 0, 1) * outer} ${outer}`} transform="rotate(-90 52 52)" />
						<circle cx="52" cy="52" r="33" className={styles.dupTrack} />
						<circle cx="52" cy="52" r="33" className={styles.dupSeg} data-kind="exact" strokeDasharray={`${clamp(exactRate, 0, 1) * inner} ${inner}`} transform="rotate(-90 52 52)" />
					</svg>
				</div>
				<div className={styles.legendList}>
					{near && (
						<div className={styles.legendRow}>
							<i className={styles.square} data-kind="near" />
							<span className={styles.legendName}>
								Near
								<Tip
									label="near duplicates"
									text={`Images that look almost the same (crops, re-saves, small edits), including the exact copies. Flagged at similarity ≥ ${near.threshold}.`}
								/>
							</span>
							<span className={styles.mono}>
								{near.near_duplicate_count.toLocaleString()} · {rate(nearRate)}
							</span>
						</div>
					)}
					{exact && (
						<div className={styles.legendRow}>
							<i className={styles.square} data-kind="exact" />
							<span className={styles.legendName}>
								Exact
								<Tip label="exact duplicates" text="Byte-for-byte identical copies of another image." />
							</span>
							<span className={styles.mono}>
								{exact.exact_duplicate_count.toLocaleString()} · {rate(exactRate)}
							</span>
						</div>
					)}
					<span className={styles.label}>Outer ring near, inner ring exact. Near already includes exact copies.</span>
				</div>
			</div>
			<div className={styles.dupTable} role="table" aria-label="Duplicate groups and cross-split leakage">
				<div className={styles.dupTableHead} role="row">
					<span role="columnheader" />
					<span role="columnheader" className={styles.dupTableTh}>
						Groups
						<Tip label="duplicate groups" text="Sets of images that are copies of each other." />
					</span>
					<span role="columnheader" className={styles.dupTableTh}>
						Cross-split
						<Tip label="cross-split leakage" text="Leakage: duplicate images that sit in both train and test. The model has already seen them, so test accuracy looks better than it is." />
					</span>
				</div>
				{rows.map((row) => (
					<div key={row.kind} className={styles.dupTableRow} role="row">
						<span role="rowheader" className={styles.dupTableName}>
							<i className={styles.square} data-kind={row.kind} />
							{row.name}
						</span>
						<span role="cell" className={styles.dupTableNum}>
							{row.groups.toLocaleString()}
						</span>
						<span role="cell" className={styles.dupTableNum} data-leak={row.cross > 0 || undefined}>
							{row.cross.toLocaleString()}
							{total > 0 && <span className={styles.dupTablePct}>{pct(row.cross / total)}</span>}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}

function ResolutionCard({ d }: { d: ResolutionConsistencyMetrics }) {
	const ar = d.aspect_ratio;
	const shape = ar.mean > 1.05 ? 'Landscape' : ar.mean < 0.95 ? 'Portrait' : 'Square';
	const modes = Object.entries(d.mode_distribution);
	const level = d.area_cv < 0.25 ? 'good' : d.area_cv < 0.5 ? 'mid' : 'poor';
	const levelName = level === 'good' ? 'Low' : level === 'mid' ? 'Moderate' : 'High';
	const sentence =
		level === 'good'
			? 'Most images are close to the same size.'
			: level === 'mid'
			? 'Image sizes vary noticeably; plan for resizing.'
			: 'Image sizes vary a lot; expect heavy resizing and cropping.';
	return (
		<div className={styles.card}>
			<CardHeader
				title="Resolution Consistency"
				info="How much image sizes and shapes vary. Uniform images need less resizing and cropping."
				badge={`${d.total_images.toLocaleString()} images`}
			/>
			<div className={styles.tileGrid}>
				<Tile label="Typical size" value={`${Math.round(d.width.mean).toLocaleString()} × ${Math.round(d.height.mean).toLocaleString()} px`} caption="avg width × height" />
				<Tile label="Width range" value={`${d.width.min.toLocaleString()} – ${d.width.max.toLocaleString()} px`} caption="smallest to largest" />
				<Tile
					label="Shape"
					value={`${shape} · ${ar.mean.toFixed(2)}`}
					caption={`ranges ${ar.min.toFixed(2)} – ${ar.max.toFixed(2)}`}
					info="Aspect ratio, width ÷ height. Above 1 is landscape, below 1 is portrait."
				/>
				<Tile
					label="Color"
					value={modes.map(([mode]) => mode).join(', ') || '—'}
					caption={modes.length === 1 ? 'all images' : modes.map(([mode, count]) => `${mode} ${pct(count / d.total_images, 0)}`).join(' · ')}
				/>
			</div>
			<div className={`${styles.stack} ${styles.divided}`}>
				<div className={styles.spaceBetween}>
					<span className={styles.variationTitle}>
						Size variation: <span data-tone={level}>{levelName}</span>
						<Tip label="area CV" lead="Area CV:" text="how much image area varies around the average. 0 means every image is the same size." />
					</span>
					<span className={styles.mono}>Area CV {d.area_cv.toFixed(2)}</span>
				</div>
				<div className={styles.scaleWrap}>
					<div className={styles.scaleBar}>
						<span data-tone="good" />
						<span data-tone="mid" />
						<span data-tone="poor" />
					</div>
					<span className={styles.scaleMarker} data-tone={level} style={{ left: `${clamp(d.area_cv * 100, 2, 98)}%` }} />
				</div>
				<div className={styles.scaleLabels}>
					<span>Low</span>
					<span>Moderate</span>
					<span>High{d.area_cv > 1 ? ' · 1.0+' : ''}</span>
				</div>
				<span className={styles.note}>{sentence}</span>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------------------------
// Content Difficulty cards

function CartographyCard({ d, backbone }: { d: Exclude<DatasetCartographyMetrics, { skipped: true }>; backbone?: string }) {
	const C = 2 * Math.PI * 54;
	const easy = (d.pct_easy / 100) * C;
	const amb = (d.pct_ambiguous / 100) * C;
	const hard = (d.pct_hard / 100) * C;
	const gap = 2;
	return (
		<div className={styles.card}>
			<CardHeader
				title="Dataset Cartography"
				info="Sorts training images by how reliably a model learns them: easy, ambiguous or hard."
				badge={backbone ? `${backbone} · ${d.n_epochs} ep` : `${d.n_epochs} epochs`}
			/>
			<div className={styles.ringRow}>
				<div className={styles.donut132}>
					<svg width="132" height="132" viewBox="0 0 132 132" aria-hidden="true">
						<circle cx="66" cy="66" r="54" className={styles.cartTrack} />
						<circle cx="66" cy="66" r="54" className={styles.cartSeg} data-tone="good" strokeDasharray={`${Math.max(0, easy - (amb || hard ? gap : 0))} ${C}`} transform="rotate(-90 66 66)" />
						<circle cx="66" cy="66" r="54" className={styles.cartSeg} data-tone="mid" strokeDasharray={`${Math.max(0, amb - (hard ? gap : 0))} ${C}`} strokeDashoffset={-easy} transform="rotate(-90 66 66)" />
						<circle cx="66" cy="66" r="54" className={styles.cartSeg} data-tone="poor" strokeDasharray={`${hard} ${C}`} strokeDashoffset={-(easy + amb)} transform="rotate(-90 66 66)" />
					</svg>
					<div className={styles.donutCenter}>
						<span className={styles.donutValueLg}>{Math.round(d.pct_easy)}%</span>
						<span className={styles.donutCaption}>easy to learn</span>
					</div>
				</div>
				<div className={styles.legendList}>
					{(
						[
							['good', 'Easy', d.n_easy],
							['mid', 'Ambiguous', d.n_ambiguous],
							['poor', 'Hard', d.n_hard],
						] as const
					).map(([tone, name, count]) => (
						<div key={name} className={styles.legendRow}>
							<i className={styles.dot} data-tone={tone} />
							<span className={styles.legendName}>{name}</span>
							<span className={styles.mono}>{count.toLocaleString()}</span>
						</div>
					))}
				</div>
			</div>
			<div className={`${styles.stack} ${styles.divided}`}>
				<Meter
					label="Mean confidence"
					value={d.mean_confidence}
					info="How sure the model is of the correct label, averaged over training. 0 to 1, higher is better."
				/>
				<Meter label="Mean variability" value={d.mean_variability} info="How much that confidence swings between epochs. High means the model keeps changing its mind." />
			</div>
		</div>
	);
}

function Meter({ label, value, info }: { label: string; value: number; info: string }) {
	return (
		<div className={styles.meter}>
			<div className={styles.spaceBetween}>
				<Label info={info} name={label}>
					{label}
				</Label>
				<strong className={styles.meterValue}>{value.toFixed(2)}</strong>
			</div>
			<div className={styles.meterTrack}>
				<div className={styles.meterFill} style={{ width: `${clamp(value, 0, 1) * 100}%` }} />
			</div>
		</div>
	);
}

// Half-circle gauge with three colored zones; `zones` are four scale stops [start, a, b, end].
function SemiGauge({ min, max, zones, value, tones }: { min: number; max: number; zones: [number, number, number, number]; value: number; tones: [Tier, Tier, Tier] }) {
	const pt = (deg: number, r: number) => {
		const a = (deg * Math.PI) / 180;
		return `${(66 + r * Math.cos(a)).toFixed(2)} ${(66 + r * Math.sin(a)).toFixed(2)}`;
	};
	const ang = (v: number) => 180 + ((clamp(v, min, max) - min) / (max - min)) * 180;
	const arc = (a: number, b: number) => `M${pt(ang(a), 56)} A56 56 0 0 1 ${pt(ang(b), 56)}`;
	const na = (ang(value) * Math.PI) / 180;
	return (
		<svg width="132" height="74" viewBox="0 0 132 74" aria-hidden="true">
			<path d={arc(zones[0], zones[1])} className={styles.semiZone} data-tone={tones[0]} />
			<path d={arc(zones[1], zones[2])} className={styles.semiZone} data-tone={tones[1]} />
			<path d={arc(zones[2], zones[3])} className={styles.semiZone} data-tone={tones[2]} />
			<line x1="66" y1="66" x2={66 + 46 * Math.cos(na)} y2={66 + 46 * Math.sin(na)} className={styles.needle} />
			<circle cx="66" cy="66" r="4.5" className={styles.needleHub} />
		</svg>
	);
}

type ClassValue = { name: string; value: number };

function LollipopRows({ rows, range, axis = true }: { rows: ClassValue[]; range: number; axis?: boolean }) {
	return (
		<div className={styles.rowGroup}>
			{rows.map(({ name, value }) => {
				const p = 50 + (clamp(value, -range, range) / range) * 50;
				return (
					<div key={name} className={styles.lolliRow}>
						<span className={styles.trunc} title={toTitleCase(name)}>
							{toTitleCase(name)}
						</span>
						<span className={styles.lolliTrack}>
							<span className={styles.lolliMid} />
							<span className={styles.lolliStem} data-neg={value < 0 || undefined} style={{ left: `${Math.min(50, p)}%`, width: `${Math.abs(p - 50)}%` }} />
							<span className={styles.lolliDot} data-neg={value < 0 || undefined} style={{ left: `${p}%` }} />
						</span>
						<span className={styles.mono}>{value.toFixed(2)}</span>
					</div>
				);
			})}
			{axis && (
			<div className={styles.lolliAxis}>
				<span />
				<span className={styles.axisTicks}>
					<span>−{range === 1 ? '1' : range.toFixed(2)}</span>
					<span>0</span>
					<span>{range === 1 ? '1' : range.toFixed(2)}</span>
				</span>
				<span />
			</div>
			)}
		</div>
	);
}

function SeparabilityCard({ d }: { d: Exclude<FeatureSeparabilityMetrics, { skipped: true }> }) {
	const [showAll, setShowAll] = useState(false);
	const rows = useMemo(() => Object.entries(d.per_class_silhouette).map(([name, value]) => ({ name, value })), [d.per_class_silhouette]);
	const many = rows.length > MANY_CLASSES;
	const asc = useMemo(() => [...rows].sort((a, b) => a.value - b.value), [rows]);
	const maxAbs = Math.max(...rows.map((r) => Math.abs(r.value)), 0);
	const range = clamp(Math.ceil(maxAbs * 4) / 4, 0.25, 1);
	const { low, high } = lowHigh(asc);
	const silTone = scoreTier(d.silhouette_score >= 0.5 ? 8 : d.silhouette_score >= 0.25 ? 6 : 2);
	const dbTone = scoreTier(d.davies_bouldin_index < 1 ? 8 : d.davies_bouldin_index < 2 ? 6 : 2);
	return (
		<div className={styles.card}>
			<CardHeader title="Feature Separability" info="How distinct the classes look to a vision model. Well-separated classes are easier to learn." badge={d.embed_model.split('/').pop()} />
			<div className={styles.tileGrid}>
				<div className={styles.gaugeTile}>
					<Label name="silhouette score" infoLead="−1 to 1, higher is better." info="Near 1: tight, separate clusters. Near 0: classes overlap. Below 0: images sit closer to another class.">
						Silhouette
					</Label>
					<div className={styles.gaugeBody}>
						<div className={styles.semiWrap}>
							<SemiGauge min={-1} max={1} zones={[-1, 0.25, 0.5, 1]} value={d.silhouette_score} tones={['poor', 'mid', 'good']} />
							<span className={styles.semiMin}>−1</span>
							<span className={styles.semiMax}>1</span>
						</div>
						<div className={styles.gaugeReadout}>
							<span className={styles.semiValue}>{d.silhouette_score.toFixed(2)}</span>
							<span className={styles.semiVerdict} data-tone={silTone}>
								{shortInterpretation(d.silhouette_interpretation)}
							</span>
						</div>
					</div>
				</div>
				<div className={styles.gaugeTile}>
					<Label name="Davies-Bouldin index" infoLead="0 and up, lower is better." info="Under 1: classes are distinct. Above 2: heavy overlap between classes.">
						Davies-Bouldin
					</Label>
					<div className={styles.gaugeBody}>
						<div className={styles.semiWrap}>
							<SemiGauge min={0} max={10} zones={[0, 1, 2, 10]} value={d.davies_bouldin_index} tones={['good', 'mid', 'poor']} />
							<span className={styles.semiMin}>0</span>
							<span className={styles.semiMax}>10</span>
						</div>
						<div className={styles.gaugeReadout}>
							<span className={styles.semiValue}>{d.davies_bouldin_index.toFixed(2)}</span>
							<span className={styles.semiVerdict} data-tone={dbTone}>
								{shortInterpretation(d.davies_bouldin_interpretation)}
							</span>
						</div>
					</div>
				</div>
			</div>
			<div className={`${styles.stack} ${styles.divided}`}>
				<Label name="per-class silhouette" info="The silhouette score for each class. Below 0 means that class blends into others.">
					{many && !showAll ? 'Silhouette by class · lowest 5' : 'Silhouette by class'}
				</Label>
				{many && !showAll ? (
					<>
						<LollipopRows rows={low} range={range} axis={false} />
						<span className={styles.groupLabel}>Highest 5</span>
						<LollipopRows rows={high} range={range} />
					</>
				) : many ? (
					<div className={styles.scrollList}>
						<LollipopRows rows={asc} range={range} />
					</div>
				) : (
					<LollipopRows rows={[...asc].reverse()} range={range} />
				)}
				{many && <ShowAllButton count={rows.length} expanded={showAll} onToggle={() => setShowAll((v) => !v)} />}
			</div>
		</div>
	);
}

function ConfusabilityCard({ d, wide }: { d: Exclude<ClassConfusabilityMetrics, { skipped: true }>; wide: boolean }) {
	// Matrix rows follow the model's label order, not the (alphabetical) accuracy keys.
	const names = useMemo(() => resolveMatrixOrder(d.per_class_accuracy, d.confusion_matrix, d.top_confused_pairs).classes, [d]);
	const keep = useMemo(() => {
		const idx = names.map((_, i) => i);
		if (names.length <= CONFUSION_CAP) return idx;
		return idx
			.sort((a, b) => d.per_class_accuracy[names[a]] - d.per_class_accuracy[names[b]])
			.slice(0, CONFUSION_CAP)
			.sort((a, b) => a - b);
	}, [d, names]);
	const capped = names.length > CONFUSION_CAP;
	const cols = `${wide ? 180 : 150}px repeat(${keep.length}, ${wide ? 'minmax(0, 1fr)' : '52px'})`;
	return (
		<div className={styles.card}>
			<CardHeader
				title="Class Confusability"
				info="How often a trained model mixes up each pair of classes on held-out test images."
				badge={`${d.n_test_samples.toLocaleString()} test`}
			/>
			<div className={wide ? styles.confWide : styles.confFew}>
				<div className={styles.stack}>
					<div className={styles.accuracyStat}>
						<strong className={styles.accuracyValue}>{pct(d.accuracy)}</strong>
						<span className={styles.accuracyLabel}>test accuracy</span>
						<Tip label="test accuracy" text="Share of held-out test images the model labels correctly." />
					</div>
					<div className={styles.matrix}>
						<div className={styles.matrixRow} style={{ gridTemplateColumns: cols }}>
							<span className={styles.matrixCorner}>true ↓ · pred →</span>
							{keep.map((_, i) => (
								<span key={i} className={styles.matrixColHead}>
									{i + 1}
								</span>
							))}
						</div>
						{keep.map((ri, rowPos) => (
							<div key={ri} className={styles.matrixRow} style={{ gridTemplateColumns: cols }}>
								<span className={styles.matrixRowHead} title={toTitleCase(names[ri])}>
									<span className={styles.mutedMono}>{rowPos + 1}</span> {toTitleCase(names[ri])}
								</span>
								{keep.map((ci) => {
									const v = d.confusion_matrix[ri]?.[ci] ?? 0;
									const alpha = Math.max(0.05, v);
									return (
										<span
											key={ci}
											className={styles.matrixCell}
											data-wide={wide || undefined}
											data-strong={alpha > 0.5 || undefined}
											data-flag={(ri !== ci && v >= CONFUSION_FLAG_MIN) || undefined}
											data-zero={v === 0 || undefined}
											title={`${toTitleCase(names[ri])} → ${toTitleCase(names[ci])}: ${pct(v)}`}
											style={{ background: `color-mix(in oklch, var(--bm-blue) ${Math.round(alpha * 100)}%, transparent)` }}
										>
											{v > 0 && v < 0.005 ? '<1' : Math.round(v * 100)}
										</span>
									);
								})}
							</div>
						))}
						<span className={styles.matrixNote}>
							{capped ? `The ${CONFUSION_CAP} classes with the lowest accuracy, out of ${names.length}. ` : ''}
							Values are % of each true class; outlined cells are confusions of {pct(CONFUSION_FLAG_MIN, 0)} or more.
						</span>
					</div>
				</div>
				<div className={styles.pairsCol}>
					<div className={styles.spaceBetween}>
						<span className={styles.label}>All confused pairs · true → predicted</span>
						<span className={styles.label}>
							{d.top_confused_pairs.length} {d.top_confused_pairs.length === 1 ? 'pair' : 'pairs'}
						</span>
					</div>
					{d.top_confused_pairs.length === 0 ? (
						<p className={styles.note}>No confused pairs: every class was classified correctly.</p>
					) : (
						<div className={styles.pairsList}>
							{d.top_confused_pairs.map((p) => (
								<div key={`${p.true_class}→${p.predicted_as}`} className={styles.pairRow}>
									<span className={`${styles.pairChip} ${styles.trunc}`} title={toTitleCase(p.true_class)}>
										{toTitleCase(p.true_class)}
									</span>
									<svg width="16" height="10" viewBox="0 0 16 10" aria-hidden="true" className={styles.pairArrow}>
										<path d="M1 5h13M10 1l4 4-4 4" />
									</svg>
									<span className={`${styles.pairChip} ${styles.trunc}`} title={toTitleCase(p.predicted_as)}>
										{toTitleCase(p.predicted_as)}
									</span>
									<span className={styles.monoRight}>{pct(p.confusion_rate)}</span>
								</div>
							))}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------------------------
// Diversity & Annotation cards

function DotRows({ rows }: { rows: ClassValue[] }) {
	return (
		<div className={styles.rowGroup}>
			{rows.map(({ name, value }) => (
				<div key={name} className={styles.dotRow}>
					<span className={styles.trunc} title={toTitleCase(name)}>
						{toTitleCase(name)}
					</span>
					<span className={styles.dotTrack}>
						<span className={styles.dotLine} />
						<span className={styles.dotTarget} style={{ left: `${DIVERSITY_FULL_SCORE * 100}%` }} />
						<span className={styles.dotFill} style={{ width: `${clamp(value, 0, 1) * 100}%` }} />
						<span className={styles.dotMark} style={{ left: `${clamp(value, 0, 1) * 100}%` }} />
					</span>
					<span className={styles.mono}>{value.toFixed(2)}</span>
				</div>
			))}
		</div>
	);
}

function DiversityCard({ d }: { d: IntraClassDiversityMetrics }) {
	const [showAll, setShowAll] = useState(false);
	const rows = useMemo(() => Object.entries(d.per_class_diversity).map(([name, value]) => ({ name, value })), [d.per_class_diversity]);
	const asc = useMemo(() => [...rows].sort((a, b) => a.value - b.value), [rows]);
	const many = rows.length > MANY_CLASSES;
	const { low, high } = lowHigh(asc);
	return (
		<div className={styles.card}>
			<CardHeader
				title="Intra-class Diversity"
				info="How different images in the same class look from each other. Higher means less redundancy."
				badge={`${rows.length} classes · ${d.embed_model.split('/').pop()}`}
			/>
			<div className={styles.bigStat}>
				<span className={styles.bigValue}>{d.mean_diversity.toFixed(2)}</span>
				<span className={styles.note}>mean embedding distance within a class</span>
			</div>
			<div className={styles.stack}>
				{many && !showAll ? (
					<>
						<span className={styles.label}>Least varied 5</span>
						<DotRows rows={low} />
						<span className={styles.groupLabel}>Most varied 5</span>
						<DotRows rows={high} />
					</>
				) : many ? (
					<div className={styles.scrollList}>
						<DotRows rows={[...asc].reverse()} />
					</div>
				) : (
					<DotRows rows={[...asc].reverse()} />
				)}
				<div className={styles.dotRow}>
					<span />
					<span className={styles.dotScale}>
						<span>0</span>
						<span className={styles.dotScaleTarget} style={{ left: `${DIVERSITY_FULL_SCORE * 100}%` }}>
							{DIVERSITY_FULL_SCORE.toFixed(2)} = full score
						</span>
						<span>1.0</span>
					</span>
					<span />
				</div>
				{many ? (
					<ShowAllButton count={rows.length} expanded={showAll} onToggle={() => setShowAll((v) => !v)} />
				) : (
					<div className={styles.chips}>
						<span className={styles.chip}>Most varied · {toTitleCase(d.max_diversity_class)}</span>
						<span className={styles.chip}>Least varied · {toTitleCase(d.min_diversity_class)}</span>
					</div>
				)}
			</div>
		</div>
	);
}

function NoiseSegment({ name, count, share, tone, width, showLabel, first, last }: { name: string; count: number; share: number; tone: number; width: number; showLabel: boolean; first: boolean; last: boolean }) {
	const id = useId();
	const { ref, schedule } = useClampedBubble();
	return (
		<button
			type="button"
			className={styles.noiseSeg}
			data-tone={tone}
			data-first={first || undefined}
			data-last={last || undefined}
			style={{ width: `${width}%` }}
			aria-label={`${toTitleCase(name)}: ${count} flagged`}
			aria-describedby={id}
			onMouseEnter={schedule}
			onFocus={schedule}
		>
			{showLabel && (
				<span className={styles.noiseSegLabel}>
					{toTitleCase(name)} · {count}
				</span>
			)}
			<span ref={ref} id={id} role="tooltip" className={`${styles.bubble} ${styles.bubbleNowrap}`}>
				<b>{toTitleCase(name)}</b> · {count} flagged ({pct(share, 0)})
			</span>
		</button>
	);
}

function LabelNoiseCard({ d, backbone }: { d: Exclude<LabelNoiseMetrics, { skipped: true }>; backbone?: string }) {
	const all = Object.entries(d.per_class_noise_counts);
	const flagged = all.filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]);
	const totalFlagged = flagged.reduce((s, [, c]) => s + c, 0);
	const distinct = Array.from(new Set(flagged.map(([, c]) => c)));
	// Most-flagged counts get noise-1 (red), fewest get noise-5 (amber); tied counts share a step.
	const toneOf = (count: number) => {
		if (distinct.length <= 1) return 1;
		const i = distinct.indexOf(count);
		return 1 + Math.round((i / (distinct.length - 1)) * 4);
	};
	const many = all.length > MANY_CLASSES;
	const rate = d.estimated_noise_rate;
	const rateTone: Tier = rate >= 0.05 ? 'poor' : rate >= 0.02 ? 'mid' : 'good';
	const cells = Array.from({ length: 100 }, (_, i) => {
		const filled = rate * 100 - i;
		if (filled >= 1) return { kind: 'full' as const };
		if (filled > 0) return { kind: 'part' as const, pct: filled * 100 };
		if (i < 10) return { kind: 'dash' as const };
		return { kind: 'empty' as const };
	});
	return (
		<div className={styles.card}>
			<CardHeader
				title="Label Noise"
				info="Images whose label probably doesn't match the picture, found by cross-validating a model."
				badge={backbone ? `${backbone} · ${d.cv_folds}-fold CV` : `${d.cv_folds}-fold CV`}
			/>
			<div className={styles.ringRow}>
				<div className={styles.waffle} aria-hidden="true">
					{cells.map((cell, i) => (
						<span
							key={i}
							className={styles.waffleCell}
							data-kind={cell.kind}
							style={cell.kind === 'part' ? { background: `linear-gradient(to right, var(--bm-poor) ${cell.pct}%, var(--bm-track) ${cell.pct}%)` } : undefined}
						/>
					))}
				</div>
				<div className={styles.stack}>
					<div className={styles.bigStat}>
						<span className={styles.bigValue} data-tone={rateTone}>
							{pct(rate)}
						</span>
						<span className={styles.note}>est. mislabeled</span>
					</div>
					<span className={styles.note}>
						{d.n_noisy_samples.toLocaleString()} of {d.n_total_samples.toLocaleString()} samples flagged. Each square is 1% of the dataset; dashed squares show where the
						score reaches 0 (10%).
					</span>
				</div>
			</div>
			{flagged.length > 0 && (
				<div className={`${styles.stack} ${styles.divided}`}>
					<span className={styles.label}>Flagged samples by class · red = most flagged, amber = fewest · hover for details</span>
					<div className={styles.noiseBar}>
						{flagged.map(([name, count], i) => (
							<NoiseSegment
								key={name}
								name={name}
								count={count}
								share={count / totalFlagged}
								tone={toneOf(count)}
								width={(count / totalFlagged) * 100}
								showLabel={!many && count / totalFlagged >= 0.12}
								first={i === 0}
								last={i === flagged.length - 1}
							/>
						))}
					</div>
					{flagged.length < all.length && (
						<span className={styles.label}>
							{flagged.length} classes have flagged samples; the other {all.length - flagged.length} have none
						</span>
					)}
				</div>
			)}
			{many && flagged.length > 0 && (
				<div className={`${styles.stack} ${styles.divided}`}>
					<span className={styles.label}>Most flagged classes · {flagged.length}</span>
					<div className={styles.flagGrid}>
						{flagged.map(([name, count]) => (
							<div key={name} className={styles.flagRow}>
								<i className={styles.square} data-noise={toneOf(count)} />
								<span className={styles.trunc} title={toTitleCase(name)}>
									{toTitleCase(name)}
								</span>
								<span className={styles.monoRight}>{count}</span>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------------------------
// Layout

function AxisSection({ id, title, question, tone, children }: { id: string; title: string; question: string; tone: string; children: ReactNode }) {
	return (
		<section id={id} className={styles.axisSection}>
			<div className={styles.axisHeader}>
				<h3 className={styles.axisTitle} data-tone={tone}>
					{title}
				</h3>
				<p className={styles.axisQuestion}>{question}</p>
			</div>
			{children}
		</section>
	);
}

function buildReproRows(info: ReproducibilityInfo | undefined): { label: string; value: string }[] {
	if (!info) return [];
	const rows: { label: string; value: string }[] = [];
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

function formatBenchmarkDate(dateStr: string): string {
	const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
	if (!match) return dateStr;
	const [, year, month, day] = match;
	return `${month}/${day}/${year}`;
}

export function BenchmarkView({ benchmark, active, visualization }: { benchmark: BenchmarkData; active: boolean; visualization?: ReactNode }) {
	const scores = useMemo(() => computeScores(benchmark), [benchmark]);
	const drivers = useMemo(() => axisDrivers(benchmark), [benchmark]);
	const reproRows = useMemo(() => buildReproRows(benchmark.reproducibility), [benchmark.reproducibility]);
	const elapsed = useEntrance(active);
	const headerRef = useRef<HTMLDivElement>(null);
	const [stripVisible, setStripVisible] = useState(false);

	// Show the compact strip once the full score header has scrolled out of the modal's view.
	useEffect(() => {
		const header = headerRef.current;
		if (!header || !active || typeof IntersectionObserver === 'undefined') {
			setStripVisible(false);
			return;
		}
		const root = header.closest('[role="dialog"]');
		const observer = new IntersectionObserver(([entry]) => setStripVisible(!entry.isIntersecting), { root, threshold: 0 });
		observer.observe(header);
		return () => observer.disconnect();
	}, [active]);

	const m = benchmark.metrics;
	const backbone = benchmark.reproducibility?.backbone;
	const classCount = m.class_imbalance ? Object.keys(m.class_imbalance.counts).length : 0;
	const many = classCount > MANY_CLASSES;

	const axisValues = AXIS_ITEMS.map((a) => scores[a.key]);
	const weakest = AXIS_ITEMS.map((a, i) => ({ label: a.label, v: axisValues[i] }))
		.filter((a): a is { label: string; v: number } => a.v != null)
		.sort((a, b) => a.v - b.v)[0];
	const overallDriver = weakest && weakest.v < 5 ? `${weakest.label} is holding this score back` : 'Weighted blend of the four axes';

	const jumpTo = (anchor: string) => {
		const el = headerRef.current?.closest('[role="dialog"]')?.querySelector(`#bm-${anchor}`);
		el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	};

	const cartography =
		m.dataset_cartography?.skipped ? (
			<SkippedCard title="Dataset Cartography" reason={m.dataset_cartography.reason} />
		) : m.dataset_cartography ? (
			<CartographyCard d={m.dataset_cartography} backbone={backbone} />
		) : null;
	const separability =
		m.feature_separability?.skipped ? (
			<SkippedCard title="Feature Separability" reason={m.feature_separability.reason} />
		) : m.feature_separability ? (
			<SeparabilityCard d={m.feature_separability} />
		) : null;
	const confusability =
		m.class_confusability?.skipped ? (
			<SkippedCard title="Class Confusability" reason={m.class_confusability.reason} />
		) : m.class_confusability ? (
			<ConfusabilityCard d={m.class_confusability} wide={many} />
		) : null;
	const labelNoise =
		m.label_noise?.skipped ? (
			<SkippedCard title="Label Noise" reason={m.label_noise.reason} />
		) : m.label_noise ? (
			<LabelNoiseCard d={m.label_noise} backbone={backbone} />
		) : null;
	const hasStructural = Boolean(m.class_imbalance || m.exact_duplicate || m.near_duplicate || m.resolution_consistency);
	const hasDifficulty = Boolean(cartography || separability || confusability);
	const runRow = (
		<div className={styles.runRow}>
			<p className={styles.runNote}>Last benchmarking check run: {formatBenchmarkDate(benchmark.date)}</p>
			{reproRows.length > 0 && (
				<details className={styles.repro}>
					<summary className={styles.reproSummary}>Reproducibility details</summary>
					<div className={styles.reproGrid}>
						{reproRows.map((row) => (
							<span key={row.label} className={styles.reproTag}>
								<span className={styles.reproKey}>{row.label}</span>
								<span className={styles.reproValue} title={row.value}>
									{row.value}
								</span>
							</span>
						))}
					</div>
				</details>
			)}
		</div>
	);

	// Some runs finished without producing any metric; an all-N/A header over empty sections
	// says nothing useful, so show one plain message instead.
	if (Object.keys(m).length === 0) {
		return (
			<div className={styles.wrap}>
				<div className={styles.root}>
					{runRow}
					<div className={styles.emptyState}>
						<p className={styles.emptyTitle}>No benchmark metrics yet</p>
						<p className={styles.note}>A benchmarking run is recorded for this dataset, but it didn't produce any metrics. Scores will appear here once a run completes.</p>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className={styles.wrap}>
			<div className={styles.root}>
				<div className={styles.stripAnchor}>
					<div className={styles.strip} data-visible={stripVisible || undefined} aria-hidden={!stripVisible}>
						{[{ short: 'Overall', value: scores.overall, anchor: 'top' }, ...AXIS_ITEMS.map((a) => ({ short: a.short, value: scores[a.key], anchor: a.anchor }))].map(
							(item, i) => (
								<button
									key={item.short}
									type="button"
									className={styles.stripItem}
									data-tier={scoreTier(item.value)}
									data-overall={i === 0 || undefined}
									tabIndex={stripVisible ? 0 : -1}
									onClick={() => (item.anchor === 'top' ? headerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) : jumpTo(item.anchor))}
								>
									<MiniRing value={item.value} />
									<span className={styles.stripText}>
										<span className={styles.stripValue}>{item.value == null ? 'N/A' : item.value.toFixed(1)}</span>
										<span className={styles.stripLabel}>{item.short}</span>
									</span>
								</button>
							),
						)}
					</div>
				</div>

				{runRow}

				<div ref={headerRef} className={styles.scoreHeader}>
					<OverallCard value={scores.overall} elapsed={elapsed} driver={overallDriver} />
					{AXIS_ITEMS.map((a, i) => (
						<AxisGaugeCard key={a.key} label={a.label} value={scores[a.key]} driver={drivers[a.key]} elapsed={elapsed} index={i} />
					))}
				</div>

				<AxisSection id="bm-structural" title="Structural Quality" question="Are the classes balanced, the images unique and the resolutions consistent?" tone="primary">
					{hasStructural ? (
						<div className={styles.grid3}>
							{m.class_imbalance && <ClassImbalanceCard d={m.class_imbalance} />}
							{(m.exact_duplicate || m.near_duplicate) && <DuplicateCard exact={m.exact_duplicate} near={m.near_duplicate} />}
							{m.resolution_consistency && <ResolutionCard d={m.resolution_consistency} />}
						</div>
					) : (
						<p className={styles.skipped}>No structural metrics were computed for this run.</p>
					)}
				</AxisSection>

				<AxisSection id="bm-difficulty" title="Content Difficulty" question="How hard is it for a model to tell the classes apart?" tone="blue">
					{hasDifficulty ? (
						<>
							{(cartography || separability) && (
								<div className={styles.gridDifficulty}>
									{cartography}
									{separability}
								</div>
							)}
							{confusability}
						</>
					) : (
						<p className={styles.skipped}>No difficulty metrics were computed for this run.</p>
					)}
				</AxisSection>

				<div className={styles.grid2Sections}>
					<AxisSection id="bm-diversity" title="Diversity & Coverage" question="How varied are images within each class?" tone="pink">
						{m.intra_class_diversity ? <DiversityCard d={m.intra_class_diversity} /> : <SkippedCard title="Intra-class Diversity" />}
					</AxisSection>
					<AxisSection id="bm-annotation" title="Annotation Reliability" question="How many labels look wrong?" tone="mid">
						{labelNoise ?? <SkippedCard title="Label Noise" />}
					</AxisSection>
				</div>

				{visualization && (
					<section className={styles.axisSection}>
						<div className={styles.axisHeader}>
							<h3 className={styles.axisTitle} data-tone="primary">
								Visualization
							</h3>
						</div>
						{visualization}
					</section>
				)}
			</div>
		</div>
	);
}
