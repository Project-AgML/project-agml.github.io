/*
	Recovers which class each confusion-matrix row belongs to.

	The benchmarking pipeline writes `per_class_accuracy` with its keys sorted alphabetically,
	but `confusion_matrix` rows/columns follow the model's own label order — the two only agree
	when the label order happens to be alphabetical (e.g. not for numeric labels like
	"0", "75", "136"). Neither field records the matrix order, so it's reconstructed: a row's
	diagonal value is that class's accuracy, and each top confused pair pins one off-diagonal
	cell, which together resolve the order (ties included) for every dataset published so far.
*/
import type { ConfusedPair } from './benchmarks';

const TOLERANCE = 0.0015;

export interface MatrixOrder {
	/** Class name for each matrix row/column index. */
	classes: string[];
	/** False when the data couldn't confirm the order and the alphabetical fallback was used. */
	confirmed: boolean;
}

function near(a: number, b: number): boolean {
	return Math.abs(a - b) <= TOLERANCE;
}

export function resolveMatrixOrder(perClassAccuracy: Record<string, number>, matrix: number[][], pairs: ConfusedPair[]): MatrixOrder {
	const names = Object.keys(perClassAccuracy);
	const n = matrix.length;
	if (n !== names.length || n === 0) return { classes: names, confirmed: false };

	const consistent = (order: string[]): boolean => {
		const index = new Map(order.map((name, i) => [name, i]));
		return (
			order.every((name, i) => near(matrix[i]?.[i] ?? NaN, perClassAccuracy[name])) &&
			pairs.every((p) => {
				const r = index.get(p.true_class);
				const c = index.get(p.predicted_as);
				return r == null || c == null || near(matrix[r]?.[c] ?? NaN, p.confusion_rate);
			})
		);
	};

	if (consistent(names)) return { classes: names, confirmed: true };

	// Backtracking over classes: each class takes a free row whose diagonal matches its accuracy,
	// and every pair whose two classes are both placed must match its cell. Classes named in a
	// pair go first (fewest candidate rows first) because they're the only ones a placement can
	// rule out; the rest have no constraint left and drop into whatever matching rows remain.
	const rowsFor = new Map(names.map((name) => [name, matrix.map((_, i) => i).filter((i) => near(matrix[i][i], perClassAccuracy[name]))]));
	if ([...rowsFor.values()].some((rows) => rows.length === 0)) return { classes: names, confirmed: false };

	const pairsByClass = new Map<string, ConfusedPair[]>();
	for (const p of pairs) {
		for (const name of [p.true_class, p.predicted_as]) {
			if (!pairsByClass.has(name)) pairsByClass.set(name, []);
			pairsByClass.get(name)!.push(p);
		}
	}
	const order = [...names].sort((a, b) => {
		const pa = pairsByClass.has(a) ? 0 : 1;
		const pb = pairsByClass.has(b) ? 0 : 1;
		return pa - pb || rowsFor.get(a)!.length - rowsFor.get(b)!.length;
	});

	const assigned: (string | undefined)[] = new Array(n);
	const rowOf = new Map<string, number>();
	let steps = 0;
	const STEP_LIMIT = 200_000;

	const fits = (name: string): boolean =>
		(pairsByClass.get(name) ?? []).every((p) => {
			const r = rowOf.get(p.true_class);
			const c = rowOf.get(p.predicted_as);
			return r == null || c == null || near(matrix[r][c], p.confusion_rate);
		});

	const place = (k: number): boolean => {
		if (k === n) return true;
		if (++steps > STEP_LIMIT) return false;
		const name = order[k];
		for (const row of rowsFor.get(name)!) {
			if (assigned[row] !== undefined) continue;
			rowOf.set(name, row);
			assigned[row] = name;
			if (fits(name) && place(k + 1)) return true;
			rowOf.delete(name);
			assigned[row] = undefined;
		}
		return false;
	};

	if (place(0)) return { classes: assigned as string[], confirmed: true };
	return { classes: names, confirmed: false };
}
