import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveMatrixOrder } from '../src/lib/confusionOrder';

describe('resolveMatrixOrder', () => {
	test('keeps the key order when it already matches the matrix', () => {
		const order = resolveMatrixOrder({ a: 0.9, b: 0.8 }, [
			[0.9, 0.1],
			[0.2, 0.8],
		], [{ true_class: 'b', predicted_as: 'a', confusion_rate: 0.2 }]);
		assert.deepEqual(order, { classes: ['a', 'b'], confirmed: true });
	});

	test('recovers a non-alphabetical label order from the diagonal', () => {
		// chili_pepper_virus_classification: keys are alphabetical, matrix rows are healthy, flood_stress, bbwv2_infected.
		const order = resolveMatrixOrder(
			{ bbwv2_infected: 0.8824, flood_stress: 0.8138, healthy: 0.995 },
			[
				[0.995, 0.0, 0.005],
				[0.1457, 0.8138, 0.0405],
				[0.1176, 0.0, 0.8824],
			],
			[{ true_class: 'flood_stress', predicted_as: 'healthy', confusion_rate: 0.1457 }],
		);
		assert.deepEqual(order.classes, ['healthy', 'flood_stress', 'bbwv2_infected']);
		assert.equal(order.confirmed, true);
	});

	test('uses confused pairs to break ties between equal accuracies', () => {
		// a and b both score 0.9; only the pairs say row 0 is b (b → a) and row 1 is a (a → c).
		const order = resolveMatrixOrder(
			{ a: 0.9, b: 0.9, c: 1 },
			[
				[0.9, 0.1, 0.0],
				[0.0, 0.9, 0.1],
				[0.0, 0.0, 1.0],
			],
			[
				{ true_class: 'b', predicted_as: 'a', confusion_rate: 0.1 },
				{ true_class: 'a', predicted_as: 'c', confusion_rate: 0.1 },
			],
		);
		assert.deepEqual(order.classes, ['b', 'a', 'c']);
	});

	test('every published matrix resolves to an order consistent with its data', () => {
		const results = JSON.parse(readFileSync(new URL('../static/data/dataset-benchmarking/results.json', import.meta.url), 'utf8'));
		for (const [name, entry] of Object.entries<any>(results)) {
			const cc = entry.metrics?.class_confusability;
			if (!cc || cc.skipped) continue;
			const order = resolveMatrixOrder(cc.per_class_accuracy, cc.confusion_matrix, cc.top_confused_pairs);
			assert.equal(order.confirmed, true, `${name}: order not confirmed`);
		}
	});
});
