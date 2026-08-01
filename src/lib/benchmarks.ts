// Dataset benchmarking metrics, loaded on demand from static/data/benchmarking-result/<dataset>.json
// (+ an optional <dataset>.embeddings.json for the UMAP scatter). One task type's metric shape is
// defined below; other task types will get their own shape as their benchmarking pipelines ship.
import { useEffect, useState } from "react";
import useBaseUrl from "@docusaurus/useBaseUrl";

export interface ClassImbalanceMetrics {
	counts: Record<string, number>;
	imbalance_ratio: number;
	normalized_entropy: number;
	most_frequent_class: string;
	least_frequent_class: string;
	total_train_examples: number;
}

export interface ExactDuplicateMetrics {
	total_images: number;
	exact_duplicate_count: number;
	exact_duplicate_rate: number;
	duplicate_groups: number;
	cross_split_duplicates: number;
}

export interface ResolutionStat {
	mean: number;
	std: number;
	min: number;
	max: number;
}

export interface ResolutionConsistencyMetrics {
	total_images: number;
	width: ResolutionStat;
	height: ResolutionStat;
	aspect_ratio: ResolutionStat;
	area_cv: number;
	mode_distribution: Record<string, number>;
}

export interface NearDuplicateMetrics {
	total_images: number;
	embed_model: string;
	threshold: number;
	near_duplicate_count: number;
	near_duplicate_rate: number;
	near_duplicate_groups: number;
	cross_split_near_duplicates: number;
	faiss_index_type: string;
}

export interface FeatureSeparabilityMetrics {
	embed_model: string;
	n_total: number;
	n_silhouette_samples: number;
	silhouette_score: number;
	silhouette_interpretation: string;
	davies_bouldin_index: number;
	davies_bouldin_interpretation: string;
	per_class_silhouette: Record<string, number>;
}

export interface IntraClassDiversityMetrics {
	embed_model: string;
	per_class_diversity: Record<string, number>;
	mean_diversity: number;
	min_diversity_class: string;
	max_diversity_class: string;
}

export interface ImageClassificationBenchmark {
	dataset: string;
	run_id: string;
	phases_completed: number[];
	metrics: {
		class_imbalance?: ClassImbalanceMetrics;
		exact_duplicate?: ExactDuplicateMetrics;
		resolution_consistency?: ResolutionConsistencyMetrics;
		metadata_coverage?: { skipped: boolean; reason?: string };
		near_duplicate?: NearDuplicateMetrics;
		feature_separability?: FeatureSeparabilityMetrics;
		intra_class_diversity?: IntraClassDiversityMetrics;
	};
}

// Only image-classification benchmarks exist today; other task types will get their own
// metric shapes later.
export type BenchmarkData = ImageClassificationBenchmark;

export interface EmbedPoint {
	x: number;
	y: number;
	z: number;
	class: string;
}

interface BenchmarkState {
	data: BenchmarkData | null;
	embeddings: EmbedPoint[] | null;
	loading: boolean;
}

const EMPTY_STATE: BenchmarkState = {
	data: null,
	embeddings: null,
	loading: false,
};

async function fetchJson<T>(url: string): Promise<T | null> {
	try {
		const response = await fetch(url);
		if (!response.ok) return null;
		return (await response.json()) as T;
	} catch {
		return null;
	}
}

// Fetches static/data/benchmarking-result/<dataset>.json (metrics) and, if present,
// <dataset>.embeddings.json (UMAP points). Returns null data when no benchmark file exists
// for this dataset (a plain 404, not an error state).
export function useBenchmark(datasetName: string | null): BenchmarkState {
	const metricsUrl = useBaseUrl(
		`/data/benchmarking-result/${datasetName ?? "_none"}.json`,
	);
	const embeddingsUrl = useBaseUrl(
		`/data/benchmarking-result/${datasetName ?? "_none"}.embeddings.json`,
	);
	const [state, setState] = useState<BenchmarkState>(EMPTY_STATE);

	useEffect(() => {
		if (!datasetName) {
			setState(EMPTY_STATE);
			return;
		}
		let cancelled = false;
		setState({ data: null, embeddings: null, loading: true });

		fetchJson<BenchmarkData>(metricsUrl).then((data) => {
			if (cancelled) return;
			if (!data) {
				setState({ data: null, embeddings: null, loading: false });
				return;
			}
			fetchJson<EmbedPoint[]>(embeddingsUrl).then((embeddings) => {
				if (cancelled) return;
				setState({
					data,
					embeddings: embeddings ?? null,
					loading: false,
				});
			});
		});

		return () => {
			cancelled = true;
		};
	}, [datasetName, metricsUrl, embeddingsUrl]);

	return state;
}
