// Pure helpers for building the Orama search index, split out of semanticSearch.ts so they can
// be unit-tested without importing that module's Docusaurus/React/CDN-loading side effects.
import type { Dataset } from './datasets';
import { MODEL_ID, DIM } from './embeddingModel.mjs';

export { MODEL_ID, DIM };

// Orama's default tokenizer splits on anything outside [A-Za-z0-9_'-] — notably NOT `_`, so
// "image_classification" stays one token and would never match a two-word query. Humanizing
// per field (instead of building one concatenated blob) lets each field keep its own BM25
// length-normalization and be boosted independently — see ORAMA_BOOST below.
export function humanize(value: string) {
  return value.replace(/[/_]/g, ' ').trim();
}

export function toLocationArray(location: Dataset['location'] | undefined): string[] {
  if (!location) return [];
  return Array.isArray(location) ? location : [location];
}

export const ORAMA_SCHEMA = {
  name: 'string',
  nameText: 'string',
  machine_learning_task: 'string',
  agricultural_task: 'string',
  crop_types: 'string[]',
  location: 'string[]',
  environment: 'string',
  sensor_modality: 'string',
  platform: 'string',
  classes: 'string',
  embedding: `vector[${DIM}]`,
} as const;

// Field-level boost so a match in a short, distinguishing field (name, task) outranks a match
// buried in the long `classes` list. Starting weights — tune empirically alongside `similarity`
// (see search() in semanticSearch.ts) once real queries can be tried against the real corpus.
export const ORAMA_BOOST = {
  name: 3,
  nameText: 3,
  machine_learning_task: 2,
  agricultural_task: 2,
  crop_types: 2,
  platform: 1.5,
  sensor_modality: 1,
  location: 1,
  environment: 1,
  classes: 0.5,
};

// name is kept exact (not humanized) alongside a separate humanized nameText field: callers
// look up results by exact dataset name (see src/pages/datasets/index.tsx's byName.get(name)),
// so `name` itself must round-trip unchanged — humanizing happens only in the field used for
// BM25 recall (e.g. "iNatAg-mini/abelmoschus_esculentus" -> "iNatAg mini abelmoschus esculentus").
export function buildIndexRow(name: string, dataset: Dataset | undefined) {
  return {
    name,
    nameText: humanize(name),
    machine_learning_task: dataset?.machine_learning_task ? humanize(dataset.machine_learning_task) : '',
    agricultural_task: dataset?.agricultural_task ? humanize(dataset.agricultural_task) : '',
    crop_types: dataset?.crop_types?.map(humanize) ?? [],
    location: toLocationArray(dataset?.location),
    environment: dataset?.environment ? humanize(dataset.environment) : '',
    sensor_modality: dataset?.sensor_modality ? humanize(dataset.sensor_modality) : '',
    platform: dataset?.platform ? humanize(dataset.platform) : '',
    // Truncated to match scripts/generate-embeddings.mjs's buildEmbeddingText(), which truncates
    // `classes` to the same length for the corpus-side embedding text.
    classes: dataset?.classes ? dataset.classes.slice(0, 300) : '',
  };
}
