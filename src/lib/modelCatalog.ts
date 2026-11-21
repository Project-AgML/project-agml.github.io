// Pure helpers for the external-model catalog (static/data/models.json). Kept free of Docusaurus
// imports so tests and the build-time validator can use the same logic as the /models page.
//
// These models are NOT hosted or benchmarked by AgML: every metric is copied from the cited source.
// Nothing here may be merged into the leaderboard (static/data/performance/) — the two answer
// different questions (AgML-run, comparable vs. self-reported, not comparable).

export type Verification =
  | 'source_reported' // numbers copied from the source, not reproduced by AgML
  | 'metrics_not_transcribed' // source has numbers we could not reliably copy (paywall, conflicts)
  | 'no_metrics_reported' // the source publishes no evaluation numbers
  | 'agml_verified'; // reserved: AgML re-ran the evaluation itself

export type DatasetAgmlStatus =
  | 'in_agml' // the same source dataset is in the AgML catalog
  | 'related_in_agml' // a related / possibly-identical dataset is in AgML (not verified the same)
  | 'not_in_agml' // public dataset that AgML does not host
  | 'not_public' // private or unreleased
  | 'not_applicable'; // e.g. a generic pretraining corpus out of AgML's scope

export type PublisherType = 'peer_reviewed' | 'institutional' | 'community';

export const PUBLISHER_LABELS: Record<PublisherType, string> = {
  peer_reviewed: 'Peer-reviewed paper',
  institutional: 'Institution / lab release',
  community: 'Community upload',
};

export const VERIFICATION_LABELS: Record<Verification, string> = {
  source_reported: 'Source-reported · unverified by AgML',
  metrics_not_transcribed: 'Metrics in source · not transcribed',
  no_metrics_reported: 'No metrics reported by source',
  agml_verified: 'Verified by AgML',
};

export const DATASET_STATUS_LABELS: Record<DatasetAgmlStatus, string> = {
  in_agml: 'In AgML',
  related_in_agml: 'Related dataset in AgML',
  not_in_agml: 'Not in AgML',
  not_public: 'Not public',
  not_applicable: 'Out of AgML scope',
};

export interface ModelDatasetRef {
  id: string;
  name: string;
  roles: string[];
  description: string | null;
  link: string | null;
  license: string | null;
  agml: { status: DatasetAgmlStatus; names: string[]; note: string | null };
}

export interface ReportedResult {
  variant: string | null;
  setting: string | null;
  eval_dataset: string | null;
  split: string | null;
  metrics: Record<string, number>;
  primary_metric: string | null;
  notes: string | null;
  source: string | null;
  source_url: string | null;
}

export interface ExternalModel {
  id: string;
  name: string;
  developer: string | null;
  publisher_type: PublisherType;
  summary: string | null;
  machine_learning_task: string | null;
  agricultural_tasks: string[];
  crop_types: string[];
  sensor_modality: string | null;
  platform: string | null;
  model_type: string | null;
  architecture: string | null;
  framework: string | null;
  license: string | null;
  links: {
    weights: string | null;
    code: string | null;
    paper: string | null;
    demo: string | null;
    model_card: string | null;
  };
  hosting: string | null;
  agml_benchmarked: boolean;
  verification: Verification;
  reported_results: ReportedResult[];
  datasets: ModelDatasetRef[];
  reproduction: { status: string | null; notes: string | null; code_url: string | null; commands: string[] };
  strong_use_cases: string | null;
  limitations: string | null;
  citation: string | null;
  added: string | null;
  last_checked: string | null;
}

export interface ModelCatalog {
  schema_version: number;
  last_updated: string | null;
  policy: string | null;
  models: ExternalModel[];
}

const VERIFICATIONS = new Set<Verification>(Object.keys(VERIFICATION_LABELS) as Verification[]);
const DATASET_STATUSES = new Set<DatasetAgmlStatus>(Object.keys(DATASET_STATUS_LABELS) as DatasetAgmlStatus[]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(text).filter((entry): entry is string => entry != null);
}

function normalizeMetrics(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]))
  );
}

function normalizeDatasetRef(value: unknown): ModelDatasetRef | null {
  if (!isRecord(value)) return null;
  const id = text(value.id);
  if (!id) return null;
  const agml = isRecord(value.agml) ? value.agml : {};
  const status = text(agml.status) as DatasetAgmlStatus | null;
  return {
    id,
    name: text(value.name) ?? id,
    roles: textList(value.roles),
    description: text(value.description),
    link: text(value.link),
    license: text(value.license),
    agml: {
      status: status && DATASET_STATUSES.has(status) ? status : 'not_in_agml',
      names: textList(agml.names),
      note: text(agml.note),
    },
  };
}

function normalizeResult(value: unknown): ReportedResult | null {
  if (!isRecord(value)) return null;
  return {
    variant: text(value.variant),
    setting: text(value.setting),
    eval_dataset: text(value.eval_dataset),
    split: text(value.split),
    metrics: normalizeMetrics(value.metrics),
    primary_metric: text(value.primary_metric),
    notes: text(value.notes),
    source: text(value.source),
    source_url: text(value.source_url),
  };
}

export function normalizeModel(value: unknown): ExternalModel | null {
  if (!isRecord(value)) return null;
  const id = text(value.id);
  const name = text(value.name);
  if (!id || !name) return null;
  const links = isRecord(value.links) ? value.links : {};
  const reproduction = isRecord(value.reproduction) ? value.reproduction : {};
  const verification = text(value.verification) as Verification | null;
  const agmlBenchmarked = value.agml_benchmarked === true;
  return {
    id,
    name,
    developer: text(value.developer),
    publisher_type: (Object.keys(PUBLISHER_LABELS) as string[]).includes(text(value.publisher_type) ?? '')
      ? (text(value.publisher_type) as PublisherType)
      : 'community',
    summary: text(value.summary),
    machine_learning_task: text(value.machine_learning_task),
    agricultural_tasks: textList(value.agricultural_tasks),
    crop_types: textList(value.crop_types).map((crop) => crop.toLowerCase()),
    sensor_modality: text(value.sensor_modality),
    platform: text(value.platform),
    model_type: text(value.model_type),
    architecture: text(value.architecture),
    framework: text(value.framework),
    license: text(value.license),
    links: {
      weights: text(links.weights),
      code: text(links.code),
      paper: text(links.paper),
      demo: text(links.demo),
      model_card: text(links.model_card),
    },
    hosting: text(value.hosting),
    agml_benchmarked: agmlBenchmarked,
    // Fail safe: anything unrecognized — or claiming verification without agml_benchmarked — is
    // shown as unverified rather than trusted.
    verification:
      verification && VERIFICATIONS.has(verification) && (verification !== 'agml_verified' || agmlBenchmarked)
        ? verification
        : 'source_reported',
    reported_results: (Array.isArray(value.reported_results) ? value.reported_results : [])
      .map(normalizeResult)
      .filter((entry): entry is ReportedResult => entry != null),
    datasets: (Array.isArray(value.datasets) ? value.datasets : [])
      .map(normalizeDatasetRef)
      .filter((entry): entry is ModelDatasetRef => entry != null),
    reproduction: {
      status: text(reproduction.status),
      notes: text(reproduction.notes),
      code_url: text(reproduction.code_url),
      commands: textList(reproduction.commands),
    },
    strong_use_cases: text(value.strong_use_cases),
    limitations: text(value.limitations),
    citation: text(value.citation),
    added: text(value.added),
    last_checked: text(value.last_checked),
  };
}

export function normalizeCatalog(json: unknown): ModelCatalog {
  const record = isRecord(json) ? json : {};
  const rawModels = Array.isArray(json) ? json : Array.isArray(record.models) ? record.models : [];
  return {
    schema_version: typeof record.schema_version === 'number' ? record.schema_version : 1,
    last_updated: text(record.last_updated),
    policy: text(record.policy),
    models: rawModels.map(normalizeModel).filter((entry): entry is ExternalModel => entry != null),
  };
}

export function isUnverified(model: ExternalModel): boolean {
  return !model.agml_benchmarked || model.verification !== 'agml_verified';
}

/** Facet value for the "Training data" filter: is any of the model's data already in AgML? */
export function dataAvailability(model: ExternalModel): 'in_agml' | 'related_in_agml' | 'not_in_agml' {
  const statuses = new Set(model.datasets.map((dataset) => dataset.agml.status));
  if (statuses.has('in_agml')) return 'in_agml';
  if (statuses.has('related_in_agml')) return 'related_in_agml';
  return 'not_in_agml';
}

export function resultSettings(model: ExternalModel): string[] {
  return Array.from(new Set(model.reported_results.map((result) => result.setting).filter((s): s is string => s != null)));
}

const METRIC_LABELS: Record<string, string> = {
  accuracy: 'Accuracy',
  top1_accuracy: 'Top-1 acc.',
  f1: 'F1',
  f1_macro: 'Macro F1',
  miou: 'mIoU',
  map: 'mAP@[.5:.95]',
  map_50: 'mAP@0.5',
  map_75: 'mAP@0.75',
  precision: 'Precision',
  recall: 'Recall',
  mean_accuracy: 'Mean acc.',
  pixel_accuracy: 'Pixel acc.',
  clustering_accuracy: 'Clustering acc.',
};

export function metricLabel(key: string): string {
  return METRIC_LABELS[key] ?? key.replace(/_/g, ' ');
}

export function formatMetricValue(value: number): string {
  // Catalog values are fractions in [0, 1]; show as percentages like the source tables do.
  return value >= 0 && value <= 1 ? `${(value * 100).toFixed(value * 100 >= 99.95 ? 0 : 1)}%` : String(value);
}

/** The single best-looking reported number, for a card's headline — always labelled as source-reported. */
export function headlineResult(model: ExternalModel): { label: string; value: string; dataset: string | null } | null {
  let best: { label: string; value: number; dataset: string | null } | null = null;
  for (const result of model.reported_results) {
    const key = result.primary_metric && result.metrics[result.primary_metric] != null
      ? result.primary_metric
      : Object.keys(result.metrics)[0];
    if (!key) continue;
    const value = result.metrics[key];
    if (best == null || value > best.value) best = { label: metricLabel(key), value, dataset: result.eval_dataset };
  }
  if (!best) return null;
  const dataset = model.datasets.find((ref) => ref.id === best!.dataset)?.name ?? best.dataset;
  return { label: best.label, value: formatMetricValue(best.value), dataset };
}

function flatten(value: unknown): string {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(flatten).join(' ');
  if (isRecord(value)) return Object.values(value).map(flatten).join(' ');
  return String(value);
}

/** Substring search over every field of a model (same "search everything" idea as the harness). */
export function modelMatchesQuery(model: ExternalModel, query: string): boolean {
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = flatten(model).toLowerCase().replace(/_/g, ' ');
  return terms.every((term) => haystack.includes(term));
}

export interface DatasetModelLink {
  model: ExternalModel;
  roles: string[];
  status: DatasetAgmlStatus;
  note: string | null;
}

/** AgML dataset name -> external models trained/evaluated on that (or a related) dataset. */
export function modelsByAgmlDataset(models: ExternalModel[]): Map<string, DatasetModelLink[]> {
  const index = new Map<string, DatasetModelLink[]>();
  for (const model of models) {
    for (const ref of model.datasets) {
      if (ref.agml.status !== 'in_agml' && ref.agml.status !== 'related_in_agml') continue;
      for (const name of ref.agml.names) {
        const links = index.get(name) ?? [];
        const existing = links.find((link) => link.model.id === model.id);
        if (existing) {
          existing.roles = Array.from(new Set([...existing.roles, ...ref.roles]));
        } else {
          links.push({ model, roles: [...ref.roles], status: ref.agml.status, note: ref.agml.note });
        }
        index.set(name, links);
      }
    }
  }
  return index;
}
