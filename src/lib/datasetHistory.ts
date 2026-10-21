import type { GrowthAnnotation } from '../components/GrowthLineChart';

export interface DatasetHistoryPoint {
	period: string;
	date: string;
	datasetCount: number;
	imageCount: number;
}

export interface DatasetHistoryAnnotation extends GrowthAnnotation {
	metric: 'datasetCount' | 'imageCount';
}

// Buckets points into fixed-length windows (in days) counted from the earliest point's date,
// keeping the most recent point in each window. Snapshots are appended by hand at whatever
// cadence someone happens to run the script, so this is what turns that irregular series into an
// even "one point every N days" chart.
export function bucketByInterval<T extends { date: string }>(points: T[], days: number): T[] {
	if (points.length === 0) return [];
	const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
	const startTime = new Date(`${sorted[0].date}T00:00:00Z`).getTime();
	const msPerBucket = days * 86_400_000;
	const buckets = new Map<number, T>();
	for (const point of sorted) {
		const bucketIndex = Math.floor((new Date(`${point.date}T00:00:00Z`).getTime() - startTime) / msPerBucket);
		buckets.set(bucketIndex, point); // last point seen per bucket wins (sorted ascending)
	}
	return [...buckets.entries()].sort(([a], [b]) => a - b).map(([, point]) => point);
}

// Bucketing can drop the exact point an annotation was anchored to, so re-anchor each annotation
// to whichever surviving point is closest in time to its original point's date.
export function remapAnnotations<T extends { date: string }>(
	annotations: DatasetHistoryAnnotation[],
	originalPoints: (T & { period: string })[],
	bucketedPoints: (T & { period: string })[],
): DatasetHistoryAnnotation[] {
	if (bucketedPoints.length === 0) return [];
	return annotations.map((annotation) => {
		const original = originalPoints.find((p) => p.period === annotation.atPeriod);
		if (!original) return annotation;
		const originalTime = new Date(`${original.date}T00:00:00Z`).getTime();
		let closest = bucketedPoints[0];
		let closestDelta = Infinity;
		for (const point of bucketedPoints) {
			const delta = Math.abs(new Date(`${point.date}T00:00:00Z`).getTime() - originalTime);
			if (delta < closestDelta) {
				closest = point;
				closestDelta = delta;
			}
		}
		return { ...annotation, atPeriod: closest.period };
	});
}
