// Implements the scoring formulas from SCORING_FORMULAS.md against a benchmark report. Kept
// separate from benchmarks.ts (data fetching) and DatasetMetadataModal.tsx (rendering) so the
// math has one source of truth that matches the published doc line for line.
import type { ImageClassificationBenchmark } from './benchmarks';

export interface AxisScores {
	overall: number | null;
	structural: number | null;
	difficulty: number | null;
	diversity: number | null;
	annotation: number | null;
}

function clamp(x: number, min: number, max: number): number {
	return Math.min(Math.max(x, min), max);
}

// A metric is "available" if its key exists in `metrics` and isn't a skipped run (e.g.
// metadata_coverage with no metadata columns detected).
function has(metrics: ImageClassificationBenchmark['metrics'], key: keyof ImageClassificationBenchmark['metrics']): boolean {
	const value = metrics[key];
	return value != null && !(value as { skipped?: boolean }).skipped;
}

export function computeScores(benchmark: ImageClassificationBenchmark): AxisScores {
	const m = benchmark.metrics;
	const phases = benchmark.phases_completed ?? [];
	const p1 = phases.includes(1);
	const p2 = phases.includes(2);
	const p3 = phases.includes(3);

	const axes: Partial<Record<'structural' | 'difficulty' | 'diversity' | 'annotation', number>> = {};

	// Axis 1 — Structural Quality
	if (p1 && has(m, 'class_imbalance') && has(m, 'exact_duplicate') && has(m, 'near_duplicate') && has(m, 'resolution_consistency')) {
		const balance = clamp(m.class_imbalance!.normalized_entropy * 10, 0, 10);
		const combined = m.exact_duplicate!.exact_duplicate_rate + m.near_duplicate!.near_duplicate_rate;
		const redundancy = clamp(10 * (1 - combined / 0.2), 0, 10);
		const resolution = clamp(10 * (1 - m.resolution_consistency!.area_cv), 0, 10);
		const crossSplit = m.exact_duplicate!.cross_split_duplicates + m.near_duplicate!.cross_split_near_duplicates;
		const penalty = clamp((crossSplit * 100) / m.exact_duplicate!.total_images, 0, 2);
		axes.structural = clamp(0.4 * balance + 0.35 * redundancy + 0.25 * resolution - penalty, 0, 10);
	}

	// Axis 2 — Content Difficulty
	if (p2 && has(m, 'feature_separability')) {
		const sep = m.feature_separability!;
		const sil = clamp(sep.silhouette_score * 10, 0, 10);
		const db = clamp(10 - sep.davies_bouldin_index * 3, 0, 10);
		const separability = (sil + db) / 2;
		if (p3 && has(m, 'dataset_cartography') && has(m, 'class_confusability')) {
			const cart = clamp(10 * (1 - m.dataset_cartography!.pct_hard / 50), 0, 10);
			const conf = clamp(m.class_confusability!.accuracy * 10, 0, 10);
			axes.difficulty = 0.4 * separability + 0.3 * cart + 0.3 * conf;
		} else {
			axes.difficulty = separability;
		}
	}

	// Axis 3 — Diversity & Coverage
	if (p2 && has(m, 'intra_class_diversity')) {
		axes.diversity = clamp((m.intra_class_diversity!.mean_diversity / 0.4) * 10, 0, 10);
	}

	// Axis 4 — Annotation Reliability
	if (p3 && has(m, 'label_noise')) {
		// Noise rates above 10% would otherwise send a negative base into a fractional exponent —
		// Math.pow(-x, 1.5) is NaN, not a large negative number, since it implies a square root of
		// a negative number. Clamping the base to 0 first keeps those cases at a flat 0 instead.
		const base = Math.max(0, 1 - m.label_noise!.estimated_noise_rate / 0.1);
		axes.annotation = clamp(10 * Math.pow(base, 1.5), 0, 10);
	}

	const weights: Record<string, number> = { structural: 0.3, difficulty: 0.25, diversity: 0.25, annotation: 0.2 };
	let weightedSum = 0;
	let totalWeight = 0;
	for (const [axis, score] of Object.entries(axes)) {
		if (score == null || Number.isNaN(score)) continue;
		weightedSum += score * weights[axis];
		totalWeight += weights[axis];
	}
	const overall = totalWeight > 0 ? weightedSum / totalWeight : null;

	const round1 = (value: number | undefined) => (value != null ? Math.round(value * 10) / 10 : null);
	return {
		overall: round1(overall ?? undefined),
		structural: round1(axes.structural),
		difficulty: round1(axes.difficulty),
		diversity: round1(axes.diversity),
		annotation: round1(axes.annotation),
	};
}
