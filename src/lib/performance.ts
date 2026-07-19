import { useEffect, useState } from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';

export interface PerformanceEntry {
  rank: number | null;
  model: string;
  score: number | null;
  submitted_by: string | null;
  date: string | null;
  link: string | null;
  notes: string | null;
  variant: 'zero-shot' | 'fine-tuned' | null;
  optimized: boolean;
  splitBreakdown: string | null;
  trainPercentage: number | null;
  datasetConfig: string | null;
  trainTimePerImage: number | null;
  infTimePerImage: number | null;
  platform: string | null;
  metrics: MetricValue[];
  metricCategories: MetricCategory[];
  categoryScores: CategoryScores;
}

export type MetricCategory = 'f1' | 'map' | 'precision_recall' | 'other';

export interface MetricValue {
  key: string;
  label: string;
  value: number;
}

export function classifyMetricLabel(label: string): MetricCategory {
  if (label === 'F1') return 'f1';
  if (label.startsWith('mAP')) return 'map';
  if (label === 'Precision' || label === 'Recall') return 'precision_recall';
  return 'other';
}

export const METRIC_CATEGORY_LABELS: Record<MetricCategory, string> = {
  f1: 'F1',
  map: 'mAP',
  precision_recall: 'Precision / Recall',
  other: 'Other',
};

export interface DatasetPerformance {
  metric: string | null;
  entries: PerformanceEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeEntry(raw: unknown): PerformanceEntry | null {
  if (!isRecord(raw)) return null;
  const model = toText(raw.model ?? raw.model_name ?? raw.name);
  if (!model) return null;

  return {
    rank: toNumber(raw.rank),
    model,
    score: toNumber(raw.score ?? raw.value ?? raw.metric_value),
    submitted_by: toText(raw.submitted_by ?? raw.submittedBy ?? raw.author),
    date: toText(raw.date ?? raw.submitted_at),
    link: toText(raw.link ?? raw.url ?? raw.source_link),
    notes: toText(raw.notes),
    variant: null,
    optimized: Boolean(raw.optimized),
    splitBreakdown: toText(raw.split_breakdown),
    trainPercentage: toNumber(raw.train_percentage),
    datasetConfig: toText(raw.dataset_config ?? raw.config),
    trainTimePerImage: toNumber(raw.train_time_per_image),
    infTimePerImage: toNumber(raw.inference_time_per_image),
    platform: toText(raw.platform ?? raw.device),
    metrics: [],
    metricCategories: [],
    categoryScores: { f1: null, map: null, precision: null, recall: null },
  };
}

// Raw benchmark run records (see static/data/performance/<dataset>.json) are converted into
// leaderboard rows here. This logic is mirrored in scripts/generate-datasets.mjs, which derives
// global.json from the same files at build time — keep the two in sync if the run schema changes.
const TASK_METRIC_KEYS: Record<string, string[]> = {
  classification: ['f1', 'accuracy', 'top1_accuracy'],
  detection: ['map', 'map_50', 'map50', 'mAP', 'mAP@0.5'],
  segmentation: ['miou', 'iou', 'mean_iou'],
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function resolveMetricKey(task: unknown, metrics: Record<string, unknown>): string | null {
  const candidates = typeof task === 'string' ? (TASK_METRIC_KEYS[task] ?? []) : [];
  for (const key of candidates) {
    if (isFiniteNumber(metrics[key])) return key;
  }
  return Object.keys(metrics).find((key) => isFiniteNumber(metrics[key])) ?? null;
}

// Every dataset can report F1, mAP, and precision/recall side by side, regardless of the
// dataset's primary task — resolveMetricKey above still picks one metric to rank/sort by, but
// this collects every recognized metric present on a run for display purposes. Detection runs in
// particular may report mAP at several IoU thresholds (map_50, map_75, map_50_95, ...); each is
// surfaced as its own labeled value rather than collapsed into one number.
const NAMED_METRIC_LABELS: Record<string, string> = {
  f1: 'F1',
  accuracy: 'Accuracy',
  top1_accuracy: 'Top-1 Accuracy',
  precision: 'Precision',
  prec: 'Precision',
  recall: 'Recall',
  rec: 'Recall',
  miou: 'mIoU',
  iou: 'IoU',
  mean_iou: 'mIoU',
};

function isMapMetricKey(key: string): boolean {
  return /^m?ap([_@-]|$)/i.test(key);
}

export interface CategoryScores {
  f1: number | null;
  map: number | null;
  precision: number | null;
  recall: number | null;
}

// Every run can report several metric families at once (F1, mAP, precision, recall),
// independent of the single metric resolveMetricKey picks for the legacy per-dataset rank.
// These four category scores back the leaderboard's four sortable global columns — precision
// and recall are ranked/percentiled independently, not averaged into one blended score.
// Mirrored in scripts/generate-datasets.mjs — keep in sync.
function computeCategoryScores(metrics: Record<string, unknown>): CategoryScores {
  const f1 = isFiniteNumber(metrics.f1) ? metrics.f1 : null;
  let map: number | null = null;
  for (const [key, value] of Object.entries(metrics)) {
    if (isMapMetricKey(key) && isFiniteNumber(value)) {
      map = map == null ? value : Math.max(map, value);
    }
  }
  const precision = isFiniteNumber(metrics.precision) ? metrics.precision : null;
  const recall = isFiniteNumber(metrics.recall) ? metrics.recall : null;
  return { f1, map, precision, recall };
}

function formatMapMetricLabel(key: string): string {
  const normalized = key.toLowerCase();
  if (normalized === 'map' || normalized === 'map50' || normalized === 'map_50' || normalized === 'mAP@0.5'.toLowerCase()) {
    return 'mAP@0.50';
  }
  const match = normalized.match(/(\d{2,3})(?:[_-](\d{2,3}))?\s*$/);
  if (!match) return 'mAP';
  const lo = (Number(match[1]) / 100).toFixed(2);
  if (match[2]) {
    const hi = (Number(match[2]) / 100).toFixed(2);
    return `mAP@[${lo}:${hi}]`;
  }
  return `mAP@${lo}`;
}

function labelForMetricKey(key: string): string | null {
  const normalized = key.toLowerCase();
  if (isMapMetricKey(normalized)) return formatMapMetricLabel(normalized);
  return NAMED_METRIC_LABELS[normalized] ?? null;
}

function collectMetrics(metrics: Record<string, unknown>): MetricValue[] {
  const results: MetricValue[] = [];
  for (const [key, value] of Object.entries(metrics)) {
    if (!isFiniteNumber(value)) continue;
    const label = labelForMetricKey(key);
    if (!label) continue;
    results.push({ key, label, value });
  }
  return results;
}

function buildRunNote(entry: Record<string, unknown>): string | null {
  const parts: string[] = ['Zero-shot'];
  if (isFiniteNumber(entry.num_samples)) parts.push(`evaluated on ${entry.num_samples} images`);
  return parts.join(' · ');
}

function buildFinetuneNote(finetune: unknown): string | null {
  if (!isRecord(finetune)) return null;
  const parts: string[] = ['Fine-tuned'];
  if (isFiniteNumber(finetune.train_samples)) parts.push(`trained on ${finetune.train_samples} images from this dataset`);
  if (isFiniteNumber(finetune.val_samples)) parts.push(`validated on ${finetune.val_samples} images`);
  if (isFiniteNumber(finetune.epochs)) parts.push(`${finetune.epochs} epochs`);
  if (isFiniteNumber(finetune.lr)) parts.push(`lr=${finetune.lr}`);
  if (isFiniteNumber(finetune.weight_decay)) parts.push(`weight decay=${finetune.weight_decay}`);
  if (isFiniteNumber(finetune.split_seed)) parts.push(`seed=${finetune.split_seed}`);
  if (isFiniteNumber(finetune.train_ratio)) parts.push(`train ratio=${finetune.train_ratio}`);
  return parts.join(' · ');
}

function computeTrainPercentage(entry: Record<string, unknown>, finetune: unknown): number | null {
  const testSamples = isFiniteNumber(entry.num_samples) ? entry.num_samples : null;
  const trainSamples = isRecord(finetune) && isFiniteNumber(finetune.train_samples) ? finetune.train_samples : null;
  const valSamples = isRecord(finetune) && isFiniteNumber(finetune.val_samples) ? finetune.val_samples : null;
  const total = (trainSamples ?? 0) + (testSamples ?? 0) + (valSamples ?? 0);
  if (!total || trainSamples == null) return null;
  return (trainSamples / total) * 100;
}

// Rendered as train/test/val percentages in that fixed order, e.g. "10/80/10" or "-/100/-" when
// a split is absent — compact enough to fit the leaderboard's narrow split column.
function buildSplitBreakdown(entry: Record<string, unknown>, finetune: unknown): string | null {
  const testSamples = isFiniteNumber(entry.num_samples) ? entry.num_samples : null;
  const trainSamples = isRecord(finetune) && isFiniteNumber(finetune.train_samples) ? finetune.train_samples : null;
  const valSamples = isRecord(finetune) && isFiniteNumber(finetune.val_samples) ? finetune.val_samples : null;
  const total = (trainSamples ?? 0) + (testSamples ?? 0) + (valSamples ?? 0);
  if (!total) return null;

  const toShare = (value: number | null) => (value != null ? ((value / total) * 100).toFixed(0) : '-');
  return `${toShare(trainSamples)}/${toShare(testSamples)}/${toShare(valSamples)}`;
}

function makeLeaderboardRow(
  entry: Record<string, unknown>,
  metricKey: string,
  variant: 'zero-shot' | 'fine-tuned'
): Omit<PerformanceEntry, 'rank'> & { score: number } {
  const metrics = entry.metrics as Record<string, unknown>;
  const finetune = entry.finetune;
  const trainSamples = isRecord(finetune) && isFiniteNumber(finetune.train_samples) ? finetune.train_samples : null;
  const trainingTimeSeconds = isRecord(finetune) && isFiniteNumber(finetune.training_time_seconds) ? finetune.training_time_seconds : null;
  const metricValues = collectMetrics(metrics);

  return {
    model: (entry.model as string).trim(),
    score: metrics[metricKey] as number,
    variant,
    date: toText(entry.timestamp)?.slice(0, 10) ?? null,
    submitted_by: null,
    link: null,
    notes: variant === 'fine-tuned' ? buildFinetuneNote(finetune) : buildRunNote(entry),
    optimized: Boolean(entry.optimized) || (isRecord(finetune) && Boolean(finetune.optimized)),
    splitBreakdown: buildSplitBreakdown(entry, finetune),
    trainPercentage: computeTrainPercentage(entry, finetune),
    datasetConfig: toText(entry.dataset_config) ?? toText(entry.split),
    trainTimePerImage: trainingTimeSeconds != null && trainSamples ? trainingTimeSeconds / trainSamples : null,
    infTimePerImage: isFiniteNumber(entry.inference_time_seconds) && isFiniteNumber(entry.num_samples) && entry.num_samples > 0
      ? entry.inference_time_seconds / entry.num_samples
      : null,
    platform: toText(entry.device),
    metrics: metricValues,
    metricCategories: Array.from(new Set(metricValues.map((metric) => classifyMetricLabel(metric.label)))),
    categoryScores: computeCategoryScores(metrics),
  };
}

// A model can appear multiple times per dataset (repeated runs, or a fine-tuned run alongside a
// zero-shot one). The leaderboard shows the best zero-shot result and the best fine-tuned result
// per model, side by side, rather than collapsing to a single row.
function buildLeaderboardFromRawResults(rawResults: unknown[]): DatasetPerformance {
  type ScoredEntry = { entry: Record<string, unknown>; metricKey: string; score: number; isFinetune: boolean };
  const scored: ScoredEntry[] = [];

  for (const raw of rawResults) {
    if (!isRecord(raw)) continue;
    const model = toText(raw.model);
    if (!model) continue;
    if (!isRecord(raw.metrics)) continue;
    const metricKey = resolveMetricKey(raw.task, raw.metrics);
    if (!metricKey || !isFiniteNumber(raw.metrics[metricKey])) continue;
    scored.push({
      entry: raw,
      metricKey,
      score: raw.metrics[metricKey] as number,
      isFinetune: isRecord(raw.finetune),
    });
  }

  const byModel = new Map<string, { zeroShot: ScoredEntry | null; fineTuned: ScoredEntry | null }>();
  for (const item of scored) {
    const model = (item.entry.model as string).trim();
    const group = byModel.get(model) ?? { zeroShot: null, fineTuned: null };
    const slot = item.isFinetune ? 'fineTuned' : 'zeroShot';
    if (!group[slot] || item.score > group[slot]!.score) group[slot] = item;
    byModel.set(model, group);
  }

  const rows: Omit<PerformanceEntry, 'rank'>[] = [];
  for (const group of byModel.values()) {
    if (group.zeroShot) rows.push(makeLeaderboardRow(group.zeroShot.entry, group.zeroShot.metricKey, 'zero-shot'));
    if (group.fineTuned) rows.push(makeLeaderboardRow(group.fineTuned.entry, group.fineTuned.metricKey, 'fine-tuned'));
  }

  rows.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
  const entries: PerformanceEntry[] = rows.map((row, index) => ({ ...row, rank: index + 1 }));

  return { metric: scored.length ? scored[0].metricKey : null, entries };
}

function normalizePerformance(json: unknown): DatasetPerformance {
  if (Array.isArray(json)) return buildLeaderboardFromRawResults(json);

  if (isRecord(json) && Array.isArray(json.leaderboard)) {
    const entries = json.leaderboard
      .map(normalizeEntry)
      .filter((entry): entry is PerformanceEntry => entry != null)
      .sort((a, b) => {
        if (a.rank != null && b.rank != null) return a.rank - b.rank;
        if (a.score != null && b.score != null) return b.score - a.score;
        return 0;
      });
    return { metric: toText(json.metric), entries };
  }

  return { metric: null, entries: [] };
}

export interface CategoryPercentiles {
  f1: number | null;
  map: number | null;
  precision: number | null;
  recall: number | null;
}

export interface GlobalPerformanceRecord {
  model: string;
  dataset: string;
  percentiles: CategoryPercentiles;
  scores: CategoryScores;
  crop_types: string[] | null;
  machine_learning_task: string | null;
  variant: 'zero-shot' | 'fine-tuned' | null;
  optimized: boolean;
  platform: string | null;
  splitBreakdown: string | null;
  datasetConfig: string | null;
}

export interface GlobalLeaderboardDatasetDetail {
  dataset: string;
  percentiles: CategoryPercentiles;
  scores: CategoryScores;
  variant: 'zero-shot' | 'fine-tuned' | null;
  optimized: boolean;
  platform: string | null;
  splitBreakdown: string | null;
  datasetConfig: string | null;
}

export function globalResultTypeKey(record: { variant: 'zero-shot' | 'fine-tuned' | null; optimized: boolean }): string | null {
  if (!record.variant) return null;
  return record.optimized ? `${record.variant}-optimized` : record.variant;
}

export function formatGlobalResultTypeKey(key: string) {
  const optimized = key.endsWith('-optimized');
  const base = optimized ? key.slice(0, -'-optimized'.length) : key;
  const label = base === 'fine-tuned' ? 'Fine-tuned' : 'Zero-shot';
  return optimized ? `${label} (optimized)` : label;
}

export interface GlobalLeaderboardEntry {
  model: string;
  machineLearningTask: string | null;
  avgF1Percentile: number | null;
  avgMapPercentile: number | null;
  avgPrecisionPercentile: number | null;
  avgRecallPercentile: number | null;
  appearances: number;
  datasets: string[];
  fineTunedDatasets: string[];
  resultType: string;
  optimized: boolean;
  datasetDetails: GlobalLeaderboardDatasetDetail[];
}

function normalizeCategoryPercentiles(raw: unknown): CategoryPercentiles {
  const record = isRecord(raw) ? raw : {};
  return {
    f1: toNumber(record.f1),
    map: toNumber(record.map),
    precision: toNumber(record.precision),
    recall: toNumber(record.recall),
  };
}

function normalizeCategoryScores(raw: unknown): CategoryScores {
  const record = isRecord(raw) ? raw : {};
  return {
    f1: toNumber(record.f1),
    map: toNumber(record.map),
    precision: toNumber(record.precision),
    recall: toNumber(record.recall),
  };
}

function normalizeGlobalPerformanceRecord(raw: unknown): GlobalPerformanceRecord | null {
  if (!isRecord(raw)) return null;
  const model = toText(raw.model);
  const dataset = toText(raw.dataset);
  const percentiles = normalizeCategoryPercentiles(raw.percentiles);
  if (!model || !dataset) return null;
  if (percentiles.f1 == null && percentiles.map == null && percentiles.precision == null && percentiles.recall == null) return null;

  const cropTypes = Array.isArray(raw.crop_types)
    ? raw.crop_types.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : null;

  const variant = raw.variant === 'zero-shot' || raw.variant === 'fine-tuned' ? raw.variant : null;

  return {
    model,
    dataset,
    percentiles,
    scores: normalizeCategoryScores(raw.scores),
    crop_types: cropTypes?.length ? cropTypes : null,
    machine_learning_task: toText(raw.machine_learning_task),
    variant,
    optimized: Boolean(raw.optimized),
    platform: toText(raw.platform),
    splitBreakdown: toText(raw.splitBreakdown),
    datasetConfig: toText(raw.datasetConfig),
  };
}

function formatResultTypeLabel(variants: Set<'zero-shot' | 'fine-tuned'>, optimized: boolean) {
  let base: string;
  if (variants.size === 0) base = '—';
  else if (variants.size > 1) base = 'Mixed';
  else base = variants.has('fine-tuned') ? 'Fine-tuned' : 'Zero-shot';

  if (base === '—') return base;
  return optimized ? `${base} (optimized)` : base;
}

export function computeGlobalLeaderboard(
  records: GlobalPerformanceRecord[],
  options: {
    cropTypes?: string[];
    mlTasks?: string[];
    resultTypes?: string[];
    tuned?: ('tuned' | 'not-tuned')[];
    optimizedValues?: ('optimized' | 'not-optimized')[];
    platforms?: string[];
    minAppearances?: number;
  } = {}
): GlobalLeaderboardEntry[] {
  const { cropTypes = [], mlTasks = [], resultTypes = [], tuned = [], optimizedValues = [], platforms = [], minAppearances = 3 } = options;
  const stats = new Map<
    string,
    {
      model: string;
      machineLearningTask: string | null;
      categoryTotals: Record<keyof CategoryPercentiles, number>;
      categoryCounts: Record<keyof CategoryPercentiles, number>;
      appearances: number;
      datasets: Set<string>;
      fineTunedDatasets: Set<string>;
      variants: Set<'zero-shot' | 'fine-tuned'>;
      optimized: boolean;
      datasetDetails: GlobalLeaderboardDatasetDetail[];
    }
  >();

  for (const record of records) {
    if (cropTypes.length && !record.crop_types?.some((crop) => cropTypes.includes(crop))) continue;
    if (mlTasks.length && !(record.machine_learning_task && mlTasks.includes(record.machine_learning_task))) continue;
    if (resultTypes.length) {
      const resultTypeKey = globalResultTypeKey(record);
      if (!resultTypeKey || !resultTypes.includes(resultTypeKey)) continue;
    }
    if (tuned.length) {
      const tunedKey = record.variant === 'fine-tuned' ? 'tuned' : 'not-tuned';
      if (!tuned.includes(tunedKey)) continue;
    }
    if (optimizedValues.length) {
      const optimizedKey = record.optimized ? 'optimized' : 'not-optimized';
      if (!optimizedValues.includes(optimizedKey)) continue;
    }
    if (platforms.length && !(record.platform && platforms.includes(record.platform))) continue;

    const key = `${record.model}|||${record.machine_learning_task ?? ''}`;
    const entryStats =
      stats.get(key) ??
      {
        model: record.model,
        machineLearningTask: record.machine_learning_task,
        categoryTotals: { f1: 0, map: 0, precision: 0, recall: 0 },
        categoryCounts: { f1: 0, map: 0, precision: 0, recall: 0 },
        appearances: 0,
        datasets: new Set<string>(),
        fineTunedDatasets: new Set<string>(),
        variants: new Set<'zero-shot' | 'fine-tuned'>(),
        optimized: false,
        datasetDetails: [] as GlobalLeaderboardDatasetDetail[],
      };
    (Object.keys(record.percentiles) as (keyof CategoryPercentiles)[]).forEach((categoryKey) => {
      const value = record.percentiles[categoryKey];
      if (value == null) return;
      entryStats.categoryTotals[categoryKey] += value;
      entryStats.categoryCounts[categoryKey] += 1;
    });
    entryStats.appearances += 1;
    entryStats.datasets.add(record.dataset);
    if (record.variant === 'fine-tuned') entryStats.fineTunedDatasets.add(record.dataset);
    if (record.variant) entryStats.variants.add(record.variant);
    if (record.optimized) entryStats.optimized = true;
    entryStats.datasetDetails.push({
      dataset: record.dataset,
      percentiles: record.percentiles,
      scores: record.scores,
      variant: record.variant,
      optimized: record.optimized,
      platform: record.platform,
      splitBreakdown: record.splitBreakdown,
      datasetConfig: record.datasetConfig,
    });
    stats.set(key, entryStats);
  }

  const average = (total: number, count: number) => (count > 0 ? total / count : null);

  return Array.from(stats.values())
    .filter((entryStats) => entryStats.appearances >= minAppearances)
    .map((entryStats) => ({
      model: entryStats.model,
      machineLearningTask: entryStats.machineLearningTask,
      avgF1Percentile: average(entryStats.categoryTotals.f1, entryStats.categoryCounts.f1),
      avgMapPercentile: average(entryStats.categoryTotals.map, entryStats.categoryCounts.map),
      avgPrecisionPercentile: average(entryStats.categoryTotals.precision, entryStats.categoryCounts.precision),
      avgRecallPercentile: average(entryStats.categoryTotals.recall, entryStats.categoryCounts.recall),
      appearances: entryStats.appearances,
      datasets: Array.from(entryStats.datasets).sort(),
      fineTunedDatasets: Array.from(entryStats.fineTunedDatasets).sort(),
      resultType: formatResultTypeLabel(entryStats.variants, entryStats.optimized),
      optimized: entryStats.optimized,
      datasetDetails: entryStats.datasetDetails.sort((a, b) => a.dataset.localeCompare(b.dataset)),
    }))
    .sort((a, b) => (b.avgMapPercentile ?? b.avgF1Percentile ?? 0) - (a.avgMapPercentile ?? a.avgF1Percentile ?? 0));
}

export function useGlobalPerformance(): {
  data: GlobalPerformanceRecord[];
  loading: boolean;
  error: Error | null;
} {
  const url = useBaseUrl('/data/performance/global.json');
  const [data, setData] = useState<GlobalPerformanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error('Failed to load global performance data');
        return response.json();
      })
      .then((json: unknown) => {
        if (!active) return;
        const records = Array.isArray(json) ? json.map(normalizeGlobalPerformanceRecord).filter((entry): entry is GlobalPerformanceRecord => entry != null) : [];
        setData(records);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err : new Error('Failed to load global performance data'));
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [url]);

  return { data, loading, error };
}

export function useDatasetPerformance(datasetName: string | null): {
  data: DatasetPerformance | null;
  loading: boolean;
  error: Error | null;
} {
  const url = useBaseUrl(`/data/performance/${datasetName ?? ''}.json`);
  const [data, setData] = useState<DatasetPerformance | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!datasetName) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    fetch(url)
      .then((response) => {
        if (response.status === 404) return null;
        if (!response.ok) throw new Error(`Failed to load performance data for ${datasetName}`);
        return response.json();
      })
      .then((json) => {
        if (!active) return;
        setData(json == null ? { metric: null, entries: [] } : normalizePerformance(json));
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err : new Error('Failed to load performance data'));
        setData(null);
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [datasetName, url]);

  return { data, loading, error };
}
