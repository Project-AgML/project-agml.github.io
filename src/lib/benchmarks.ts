// Dataset benchmarking metrics, loaded on demand from the shared
// static/data/dataset-benchmarking/results.json (keyed by dataset name), plus optional
// per-dataset UMAP embedding files under static/data/dataset-benchmarking/embeddings/
// (<dataset>_umap_2d.json / <dataset>_umap_3d.json). One task type's metric shape is defined
// below; other task types will get their own shape as their benchmarking pipelines ship.
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

export interface DatasetCartographyMetrics {
	n_easy: number;
	n_ambiguous: number;
	n_hard: number;
	pct_easy: number;
	pct_ambiguous: number;
	pct_hard: number;
	mean_confidence: number;
	mean_variability: number;
	easy_threshold: number;
	hard_threshold: number;
	variability_threshold: number;
	n_epochs: number;
}

export interface ConfusedPair {
	true_class: string;
	predicted_as: string;
	confusion_rate: number;
}

export interface ClassConfusabilityMetrics {
	accuracy: number;
	per_class_accuracy: Record<string, number>;
	confusion_matrix: number[][];
	top_confused_pairs: ConfusedPair[];
	n_top_pairs: number;
	n_test_samples: number;
}

export interface LabelNoiseMetrics {
	estimated_noise_rate: number;
	n_noisy_samples: number;
	n_total_samples: number;
	flagged_orig_indices?: number[];
	per_class_noise_counts: Record<string, number>;
	cv_folds: number;
}

export interface ReproducibilityInfo {
	split_seed?: number;
	train_ratio?: number;
	val_ratio?: number;
	test_ratio?: number;
	embed_model?: string;
	near_dup_threshold?: number;
	backbone?: string;
	cartography_epochs?: number;
	cartography_lr?: number;
	cv_folds?: number;
}

export interface ImageClassificationBenchmark {
	dataset: string;
	date: string;
	reproducibility?: ReproducibilityInfo;
	phases_completed?: number[];
	metrics: {
		class_imbalance?: ClassImbalanceMetrics;
		exact_duplicate?: ExactDuplicateMetrics;
		resolution_consistency?: ResolutionConsistencyMetrics;
		metadata_coverage?: { skipped: boolean; reason?: string; metadata_columns?: string[]; normalized_entropy?: Record<string, Record<string, number>> };
		near_duplicate?: NearDuplicateMetrics;
		feature_separability?: FeatureSeparabilityMetrics;
		intra_class_diversity?: IntraClassDiversityMetrics;
		dataset_cartography?: DatasetCartographyMetrics;
		class_confusability?: ClassConfusabilityMetrics;
		label_noise?: LabelNoiseMetrics;
	};
}

// Only image-classification benchmarks exist today; other task types will get their own
// metric shapes later.
export type BenchmarkData = ImageClassificationBenchmark;

type BenchmarkResults = Record<string, BenchmarkData>;

// One row per sample from a UMAP projection. 2D files omit `z`.
export interface EmbedPoint {
	x: number;
	y: number;
	z?: number;
	label: string;
	split?: string;
	index?: number;
}

interface BenchmarkState {
	data: BenchmarkData | null;
	embeddings2d: EmbedPoint[] | null;
	embeddings3d: EmbedPoint[] | null;
	loading: boolean;
}

const EMPTY_STATE: BenchmarkState = {
	data: null,
	embeddings2d: null,
	embeddings3d: null,
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

// results.json is one shared file covering every dataset, so it only needs to be
// fetched once per page load rather than once per dataset looked up.
let resultsPromise: Promise<BenchmarkResults> | null = null;
function loadResults(url: string): Promise<BenchmarkResults> {
	if (!resultsPromise) {
		resultsPromise = fetchJson<BenchmarkResults>(url).then((data) => data ?? {});
	}
	return resultsPromise;
}

// Looks up `datasetName` in the shared results.json and, if found, fetches that dataset's
// 2D and 3D UMAP embedding files. Returns null data when the dataset has no benchmark entry
// (a missing key, not an error state) or when the fetch itself fails.
export function useBenchmark(datasetName: string | null): BenchmarkState {
	const resultsUrl = useBaseUrl("/data/dataset-benchmarking/results.json");
	const embeddings2dUrl = useBaseUrl(
		`/data/dataset-benchmarking/embeddings/${datasetName ?? "_none"}_umap_2d.json`,
	);
	const embeddings3dUrl = useBaseUrl(
		`/data/dataset-benchmarking/embeddings/${datasetName ?? "_none"}_umap_3d.json`,
	);
	const [state, setState] = useState<BenchmarkState>(EMPTY_STATE);

	useEffect(() => {
		if (!datasetName) {
			setState(EMPTY_STATE);
			return;
		}
		let cancelled = false;
		setState({ data: null, embeddings2d: null, embeddings3d: null, loading: true });

		loadResults(resultsUrl).then((results) => {
			if (cancelled) return;
			const data = results[datasetName] ?? null;
			if (!data) {
				setState({ data: null, embeddings2d: null, embeddings3d: null, loading: false });
				return;
			}
			Promise.all([
				fetchJson<EmbedPoint[]>(embeddings2dUrl),
				fetchJson<EmbedPoint[]>(embeddings3dUrl),
			]).then(([embeddings2d, embeddings3d]) => {
				if (cancelled) return;
				setState({
					data,
					embeddings2d: embeddings2d ?? null,
					embeddings3d: embeddings3d ?? null,
					loading: false,
				});
			});
		});

		return () => {
			cancelled = true;
		};
	}, [datasetName, resultsUrl, embeddings2dUrl, embeddings3dUrl]);

	return state;
}
