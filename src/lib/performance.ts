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
}

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

function buildRunNote(entry: Record<string, unknown>): string | null {
  const parts: string[] = [];
  if (isFiniteNumber(entry.num_samples)) parts.push(`${entry.num_samples} samples`);
  const device = toText(entry.device);
  if (device) parts.push(device);
  return parts.length ? parts.join(' · ') : null;
}

function buildFinetuneNote(finetune: unknown): string | null {
  if (!isRecord(finetune)) return null;
  const parts: string[] = [];
  if (isFiniteNumber(finetune.epochs)) parts.push(`${finetune.epochs} epochs`);
  if (isFiniteNumber(finetune.train_samples)) parts.push(`${finetune.train_samples} train samples`);
  return parts.length ? parts.join(' · ') : null;
}

function makeLeaderboardRow(
  entry: Record<string, unknown>,
  metricKey: string,
  variant: 'zero-shot' | 'fine-tuned'
): Omit<PerformanceEntry, 'rank'> & { score: number } {
  const metrics = entry.metrics as Record<string, unknown>;
  return {
    model: (entry.model as string).trim(),
    score: metrics[metricKey] as number,
    variant,
    date: toText(entry.timestamp)?.slice(0, 10) ?? null,
    submitted_by: null,
    link: null,
    notes: variant === 'fine-tuned' ? buildFinetuneNote(entry.finetune) : buildRunNote(entry),
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

export interface GlobalPerformanceRecord {
  model: string;
  dataset: string;
  percentile: number;
  crop_types: string[] | null;
  machine_learning_task: string | null;
  variant: 'zero-shot' | 'fine-tuned' | null;
}

export interface GlobalLeaderboardEntry {
  model: string;
  averagePercentile: number;
  appearances: number;
  datasets: string[];
  fineTunedDatasets: string[];
}

function normalizeGlobalPerformanceRecord(raw: unknown): GlobalPerformanceRecord | null {
  if (!isRecord(raw)) return null;
  const model = toText(raw.model);
  const dataset = toText(raw.dataset);
  const percentile = toNumber(raw.percentile);
  if (!model || !dataset || percentile == null) return null;

  const cropTypes = Array.isArray(raw.crop_types)
    ? raw.crop_types.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : null;

  const variant = raw.variant === 'zero-shot' || raw.variant === 'fine-tuned' ? raw.variant : null;

  return {
    model,
    dataset,
    percentile,
    crop_types: cropTypes?.length ? cropTypes : null,
    machine_learning_task: toText(raw.machine_learning_task),
    variant,
  };
}

export function computeGlobalLeaderboard(
  records: GlobalPerformanceRecord[],
  options: { cropTypes?: string[]; mlTasks?: string[]; minAppearances?: number } = {}
): GlobalLeaderboardEntry[] {
  const { cropTypes = [], mlTasks = [], minAppearances = 3 } = options;
  const stats = new Map<
    string,
    { totalPercentile: number; appearances: number; datasets: Set<string>; fineTunedDatasets: Set<string> }
  >();

  for (const record of records) {
    if (cropTypes.length && !record.crop_types?.some((crop) => cropTypes.includes(crop))) continue;
    if (mlTasks.length && !(record.machine_learning_task && mlTasks.includes(record.machine_learning_task))) continue;

    const entryStats =
      stats.get(record.model) ?? { totalPercentile: 0, appearances: 0, datasets: new Set(), fineTunedDatasets: new Set() };
    entryStats.totalPercentile += record.percentile;
    entryStats.appearances += 1;
    entryStats.datasets.add(record.dataset);
    if (record.variant === 'fine-tuned') entryStats.fineTunedDatasets.add(record.dataset);
    stats.set(record.model, entryStats);
  }

  return Array.from(stats.entries())
    .filter(([, entryStats]) => entryStats.appearances >= minAppearances)
    .map(([model, entryStats]) => ({
      model,
      averagePercentile: entryStats.totalPercentile / entryStats.appearances,
      appearances: entryStats.appearances,
      datasets: Array.from(entryStats.datasets).sort(),
      fineTunedDatasets: Array.from(entryStats.fineTunedDatasets).sort(),
    }))
    .sort((a, b) => b.averagePercentile - a.averagePercentile);
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
