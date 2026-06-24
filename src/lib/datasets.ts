import { useEffect, useMemo, useState } from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';

export interface Dataset {
  name: string;
  source: 'agml' | 'huggingface' | string | null;
  machine_learning_task: string | null;
  agricultural_task: string | null;
  location: string | string[] | null;
  environment: string | null;
  augmented_counterpart: string | null;
  crop_types: string[] | null;
  sensor_modality: string | null;
  real_or_synthetic: string | null;
  platform: string | null;
  input_data_format: string | null;
  annotation_format: string | null;
  num_images: number | null;
  augmented_num_images: number | null;
  augmented_zip_size_bytes: number | null;
  documentation: string | null;
  classes: string | null;
  stats_mean: number[] | null;
  stats_std: number[] | null;
  examples_image_url: string | null;
  license: string | null;
  citation: string | null;
  parent_dataset?: string | null;
  zip_size_bytes?: number | null;
  hf_link?: string | null;
}

type DatasetRecord = Record<string, unknown>;

export type DatasetFieldFilter = {
  field: keyof Dataset;
  values?: string[];
  mode?: 'exact' | 'containsAny';
};

const DATASET_MANIFESTS = ['/data/datasets.json', '/data/hf_datasets.json'] as const;

function isRecord(value: unknown): value is DatasetRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toNumberArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const numbers = value.map((entry) => toNumber(entry));
  return numbers.every((entry) => entry != null) ? (numbers as number[]) : null;
}

function toText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const parts = value.map((entry) => toText(entry)).filter((entry): entry is string => entry != null);
    return parts.length ? parts.join(', ') : null;
  }
  if (isRecord(value)) {
    const parts = Object.entries(value)
      .map(([key, entry]) => {
        const text = toText(entry);
        return text ? `${key}: ${text}` : null;
      })
      .filter((entry): entry is string => entry != null);
    return parts.length ? parts.join('; ') : null;
  }
  return null;
}

function toStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const parts = value
    .map((entry) => firstString(entry))
    .filter((entry): entry is string => entry != null);
  return parts.length ? parts : null;
}

function normalizeLocation(value: unknown): string | string[] | null {
  if (Array.isArray(value)) return toStringArray(value);
  return firstString(value);
}

function normalizeDataset(raw: unknown): Dataset | null {
  if (!isRecord(raw)) return null;

  const stats = isRecord(raw.stats) ? raw.stats : null;
  const name = firstString(raw.name, raw.dataset, raw.slug, raw.id, raw.key);
  if (!name) return null;

  const augmentedNumImages = toNumber(raw.augmented_num_images ?? raw.augmented_n_images ?? raw.augmented_image_count);
  const augmentedCounterpart =
    firstString(raw.augmented_counterpart) ?? (augmentedNumImages != null ? 'yes' : 'no');

  return {
    name,
    machine_learning_task: firstString(raw.machine_learning_task, raw.ml_task, raw.task),
    source: firstString(raw.source),
    agricultural_task: firstString(raw.agricultural_task, raw.ag_task),
    location: normalizeLocation(raw.location),
    environment: firstString(raw.environment, raw.env, raw.image_environment)?.toLowerCase() ?? null,
    augmented_counterpart: augmentedCounterpart,
    crop_types: toStringArray(raw.crop_types ?? raw.cropType ?? raw.crop_type)?.map((c) => c.toLowerCase()) ?? null,
    sensor_modality: firstString(raw.sensor_modality, raw.sensor, raw.modality),
    real_or_synthetic: firstString(raw.real_or_synthetic, raw.real_synthetic),
    platform: firstString(raw.platform),
    input_data_format: firstString(raw.input_data_format, raw.input_format),
    annotation_format: firstString(raw.annotation_format),
    num_images: toNumber(raw.num_images ?? raw.n_images ?? raw.image_count),
    augmented_num_images: augmentedNumImages,
    augmented_zip_size_bytes: toNumber(raw.augmented_zip_size_bytes ?? raw.augmentedZipSizeBytes),
    documentation: firstString(raw.documentation, raw.docs_url, raw.doc_url, raw.url),
    classes: toText(raw.classes),
    stats_mean: toNumberArray(raw.stats_mean ?? stats?.mean),
    stats_std: toNumberArray(raw.stats_std ?? stats?.std),
    examples_image_url: firstString(raw.examples_image_url, raw.example_image_url, raw.examples_url, raw.image_url),
    license: firstString(raw.license),
    citation: firstString(raw.citation),
    parent_dataset: firstString(raw.parent_dataset, raw.parentDataset),
    zip_size_bytes: toNumber(raw.zip_size_bytes ?? raw.zipSizeBytes),
    hf_link: firstString(raw.hf_link, raw.huggingface_link, raw.hf_url),
  };
}

function mergeDataset(current: Dataset, incoming: Dataset): Dataset {
  return {
    name: current.name,
    machine_learning_task: current.machine_learning_task ?? incoming.machine_learning_task,
    source: current.source ?? incoming.source,
    agricultural_task: current.agricultural_task ?? incoming.agricultural_task,
    location: current.location ?? incoming.location,
    environment: current.environment ?? incoming.environment,
    augmented_counterpart: current.augmented_counterpart ?? incoming.augmented_counterpart,
    crop_types: current.crop_types ?? incoming.crop_types,
    sensor_modality: current.sensor_modality ?? incoming.sensor_modality,
    real_or_synthetic: current.real_or_synthetic ?? incoming.real_or_synthetic,
    platform: current.platform ?? incoming.platform,
    input_data_format: current.input_data_format ?? incoming.input_data_format,
    annotation_format: current.annotation_format ?? incoming.annotation_format,
    num_images: current.num_images ?? incoming.num_images,
    augmented_num_images: current.augmented_num_images ?? incoming.augmented_num_images,
    augmented_zip_size_bytes: current.augmented_zip_size_bytes ?? incoming.augmented_zip_size_bytes,
    documentation: current.documentation ?? incoming.documentation,
    classes: current.classes ?? incoming.classes,
    stats_mean: current.stats_mean ?? incoming.stats_mean,
    stats_std: current.stats_std ?? incoming.stats_std,
    examples_image_url: current.examples_image_url ?? incoming.examples_image_url,
    license: current.license ?? incoming.license,
    citation: current.citation ?? incoming.citation,
    parent_dataset: current.parent_dataset ?? incoming.parent_dataset,
    zip_size_bytes: current.zip_size_bytes ?? incoming.zip_size_bytes,
    hf_link: current.hf_link ?? incoming.hf_link,
  };
}

function normalizeManifest(json: unknown): Dataset[] {
  const records = Array.isArray(json) ? json : isRecord(json) ? Object.values(json) : [];
  return records.map(normalizeDataset).filter((entry): entry is Dataset => entry != null);
}

async function fetchManifest(manifestUrl: string): Promise<Dataset[]> {
  const response = await fetch(manifestUrl);
  if (!response.ok) {
    throw new Error(`Failed to load ${manifestUrl}`);
  }
  return normalizeManifest(await response.json());
}

export async function loadDatasets(manifestUrls: string[]): Promise<Dataset[]> {
  const results = await Promise.allSettled(manifestUrls.map((manifestUrl) => fetchManifest(manifestUrl)));
  const merged = new Map<string, Dataset>();
  let loadedAny = false;

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    loadedAny = true;
    for (const entry of result.value) {
      const existing = merged.get(entry.name);
      merged.set(entry.name, existing ? mergeDataset(existing, entry) : entry);
    }
  }

  if (loadedAny) {
    return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  const firstError = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  throw firstError?.reason instanceof Error ? firstError.reason : new Error('Failed to load datasets');
}

export function useDatasets(): { data: Dataset[]; loading: boolean; error: Error | null } {
  const [data, setData] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const manifestUrls = DATASET_MANIFESTS.map((manifest) => useBaseUrl(manifest));

  useEffect(() => {
    let active = true;
    loadDatasets(manifestUrls)
      .then((next) => {
        if (!active) return;
        setData(next);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err : new Error('Failed to load datasets'));
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [manifestUrls]);

  return { data, loading, error };
}

function matchesFieldValue(value: string | string[] | null | undefined, values: string[], mode: 'exact' | 'containsAny') {
  if (value == null || values.length === 0) return false;
  if (Array.isArray(value)) {
    return mode === 'containsAny'
      ? value.some((entry) => values.includes(entry))
      : value.some((entry) => values.includes(entry));
  }
  if (mode === 'containsAny') {
    return values.some((entry) => value.toLowerCase().includes(entry.toLowerCase()));
  }
  return values.includes(value);
}

export function filterDatasets(
  datasets: Dataset[],
  opts: {
    q?: string;
    fieldFilters?: DatasetFieldFilter[];
    mlTasks?: string[];
    agTasks?: string[];
    platforms?: string[];
    realOrSynthetic?: string[];
    includeChildren?: boolean;
  }
): Dataset[] {
  let out = datasets;

  if (opts.includeChildren === false) {
    out = out.filter((d) => !d.parent_dataset);
  }

  if (opts.q?.trim()) {
    const q = opts.q.trim().toLowerCase();
    out = out.filter((d) => {
      const locationMatches = Array.isArray(d.location)
        ? d.location.some((entry) => entry.toLowerCase().includes(q))
        : d.location?.toLowerCase().includes(q) ?? false;
      const cropMatches = d.crop_types?.some((entry) => entry.toLowerCase().includes(q)) ?? false;
      return (
        d.name.toLowerCase().includes(q) ||
        d.agricultural_task?.toLowerCase().includes(q) ||
        d.machine_learning_task?.toLowerCase().includes(q) ||
        d.environment?.toLowerCase().includes(q) ||
        d.augmented_counterpart?.toLowerCase().includes(q) ||
        d.platform?.toLowerCase().includes(q) ||
        locationMatches ||
        cropMatches
      );
    });
  }

  for (const filter of opts.fieldFilters ?? []) {
    if (!filter.values?.length) continue;
    out = out.filter((dataset) => matchesFieldValue(dataset[filter.field] as string | string[] | null | undefined, filter.values!, filter.mode ?? 'exact'));
  }

  if (opts.mlTasks?.length) {
    out = out.filter((d) => d.machine_learning_task != null && opts.mlTasks!.includes(d.machine_learning_task));
  }
  if (opts.agTasks?.length) {
    out = out.filter((d) => d.agricultural_task != null && opts.agTasks!.includes(d.agricultural_task));
  }
  if (opts.platforms?.length) {
    out = out.filter((d) => d.platform != null && opts.platforms!.includes(d.platform));
  }
  if (opts.realOrSynthetic?.length) {
    out = out.filter((d) => d.real_or_synthetic != null && opts.realOrSynthetic!.includes(d.real_or_synthetic));
  }

  return out;
}

export function useDatasetOptions(data: Dataset[]) {
  return useMemo(() => {
    const unique = (values: Array<string | string[] | null | undefined>, sort = true) => {
      const flattened = values.flatMap((value) => (Array.isArray(value) ? value : value != null ? [value] : []));
      const set = new Set(flattened.filter((value) => Boolean(value && String(value).trim())));
      const list = Array.from(set);
      if (sort) list.sort((a, b) => a.localeCompare(b));
      return list;
    };

    return {
      mlTasks: unique(data.map((d) => d.machine_learning_task)),
      agTasks: unique(data.map((d) => d.agricultural_task)),
      environments: unique(data.map((d) => d.environment)),
      augmentedCounterparts: unique(data.map((d) => d.augmented_counterpart)),
      cropTypes: unique(data.flatMap((d) => d.crop_types ?? [])),
      locations: unique(data.map((d) => d.location)),
      platforms: unique(data.map((d) => d.platform)),
      realOptions: unique(data.map((d) => d.real_or_synthetic)),
    };
  }, [data]);
}

export function formatDisplayLocation(value: string | string[] | null | undefined): string {
  if (value == null) return '—';
  return Array.isArray(value) ? value.join(', ') : value;
}
