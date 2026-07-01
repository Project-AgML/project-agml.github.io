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
  };
}

function normalizePerformance(json: unknown): DatasetPerformance {
  const rawEntries = Array.isArray(json)
    ? json
    : isRecord(json) && Array.isArray(json.leaderboard)
      ? json.leaderboard
      : [];
  const entries = rawEntries
    .map(normalizeEntry)
    .filter((entry): entry is PerformanceEntry => entry != null)
    .sort((a, b) => {
      if (a.rank != null && b.rank != null) return a.rank - b.rank;
      if (a.score != null && b.score != null) return b.score - a.score;
      return 0;
    });

  const metric = isRecord(json) ? toText(json.metric) : null;

  return { metric, entries };
}

export interface GlobalPerformanceRecord {
  model: string;
  dataset: string;
  percentile: number;
  crop_types: string[] | null;
  machine_learning_task: string | null;
}

export interface GlobalLeaderboardEntry {
  model: string;
  averagePercentile: number;
  appearances: number;
  datasets: string[];
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

  return {
    model,
    dataset,
    percentile,
    crop_types: cropTypes?.length ? cropTypes : null,
    machine_learning_task: toText(raw.machine_learning_task),
  };
}

export function computeGlobalLeaderboard(
  records: GlobalPerformanceRecord[],
  options: { cropTypes?: string[]; mlTasks?: string[]; minAppearances?: number } = {}
): GlobalLeaderboardEntry[] {
  const { cropTypes = [], mlTasks = [], minAppearances = 3 } = options;
  const stats = new Map<string, { totalPercentile: number; appearances: number; datasets: Set<string> }>();

  for (const record of records) {
    if (cropTypes.length && !record.crop_types?.some((crop) => cropTypes.includes(crop))) continue;
    if (mlTasks.length && !(record.machine_learning_task && mlTasks.includes(record.machine_learning_task))) continue;

    const entryStats = stats.get(record.model) ?? { totalPercentile: 0, appearances: 0, datasets: new Set() };
    entryStats.totalPercentile += record.percentile;
    entryStats.appearances += 1;
    entryStats.datasets.add(record.dataset);
    stats.set(record.model, entryStats);
  }

  return Array.from(stats.entries())
    .filter(([, entryStats]) => entryStats.appearances >= minAppearances)
    .map(([model, entryStats]) => ({
      model,
      averagePercentile: entryStats.totalPercentile / entryStats.appearances,
      appearances: entryStats.appearances,
      datasets: Array.from(entryStats.datasets).sort(),
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
