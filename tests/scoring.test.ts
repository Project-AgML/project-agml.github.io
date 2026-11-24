import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeScores } from '../src/lib/scoring';
import type { ImageClassificationBenchmark } from '../src/lib/benchmarks';

function structuralOnly(exactRate: number, nearRate: number, exactCross: number, nearCross: number): ImageClassificationBenchmark {
	return {
		dataset: 'test',
		date: '2026-01-01',
		phases_completed: [1],
		metrics: {
			class_imbalance: { counts: { a: 50, b: 50 }, imbalance_ratio: 1, normalized_entropy: 1, most_frequent_class: 'a', least_frequent_class: 'b', total_train_examples: 100 },
			exact_duplicate: { total_images: 1000, exact_duplicate_count: exactRate * 1000, exact_duplicate_rate: exactRate, duplicate_groups: 1, cross_split_duplicates: exactCross },
			near_duplicate: {
				total_images: 1000,
				embed_model: 'm',
				threshold: 0.98,
				near_duplicate_count: nearRate * 1000,
				near_duplicate_rate: nearRate,
				near_duplicate_groups: 1,
				cross_split_near_duplicates: nearCross,
				faiss_index_type: 'IndexFlatIP',
			},
			resolution_consistency: {
				total_images: 1000,
				width: { mean: 100, std: 0, min: 100, max: 100 },
				height: { mean: 100, std: 0, min: 100, max: 100 },
				aspect_ratio: { mean: 1, std: 0, min: 1, max: 1 },
				area_cv: 0,
				mode_distribution: { RGB: 1000 },
			},
		},
	};
}

describe('structural redundancy', () => {
	test('uses the larger duplicate rate instead of adding exact and near', () => {
		// Near (4%) already contains the exact copies (2%): redundancy = 10 × (1 − 0.04 / 0.2) = 8.
		const s = computeScores(structuralOnly(0.02, 0.04, 0, 0));
		assert.equal(s.structural, Math.round((0.4 * 10 + 0.35 * 8 + 0.25 * 10) * 10) / 10);
	});

	test('removing only exact duplicates does not help while near duplicates remain', () => {
		const withExact = computeScores(structuralOnly(0.03, 0.05, 0, 0)).structural;
		const exactRemoved = computeScores(structuralOnly(0, 0.05, 0, 0)).structural;
		assert.equal(withExact, exactRemoved);
	});

	test('cross-split penalty uses the larger cross-split count', () => {
		// max(5, 10) = 10 of 1,000 images → 1 point, not (5 + 10) → 1.5.
		const s = computeScores(structuralOnly(0, 0, 5, 10));
		assert.equal(s.structural, 9);
	});
});
