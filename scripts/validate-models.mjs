// Validates static/data/models.json (the external-model catalog) against the dataset manifests.
// Runs before every build/start (see package.json) and fails the build on errors, so a model can't
// silently claim AgML verification, link to an AgML dataset that doesn't exist, or show a metric
// without a source.
//
//   node scripts/validate-models.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const VERIFICATIONS = new Set(['source_reported', 'metrics_not_transcribed', 'no_metrics_reported', 'agml_verified']);
const DATASET_STATUSES = new Set(['in_agml', 'related_in_agml', 'not_in_agml', 'not_public', 'not_applicable']);
const ML_TASKS = new Set([
  'image_classification',
  'object_detection',
  'semantic_segmentation',
  'instance_segmentation',
  'image_regression',
  'image-text-to-text',
]);
const DATASET_ROLES = new Set(['train', 'eval', 'pretrain']);
const PUBLISHER_TYPES = new Set(['peer_reviewed', 'institutional', 'community']);

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateModelCatalog(catalog, agmlDatasetNames) {
  const errors = [];
  const warnings = [];
  if (!isRecord(catalog) || !Array.isArray(catalog.models)) {
    return { errors: ['models.json must be an object with a "models" array'], warnings };
  }

  const seen = new Set();
  for (const [index, model] of catalog.models.entries()) {
    const where = `models[${index}]${model?.id ? ` (${model.id})` : ''}`;
    if (!isRecord(model)) {
      errors.push(`${where}: not an object`);
      continue;
    }
    if (!nonEmpty(model.id)) errors.push(`${where}: missing id`);
    else if (!/^[a-z0-9][a-z0-9-]*$/.test(model.id)) errors.push(`${where}: id must be lowercase kebab-case`);
    else if (seen.has(model.id)) errors.push(`${where}: duplicate id`);
    else seen.add(model.id);

    if (!nonEmpty(model.name)) errors.push(`${where}: missing name`);
    if (!PUBLISHER_TYPES.has(model.publisher_type)) errors.push(`${where}: publisher_type must be peer_reviewed, institutional or community`);
    if (!ML_TASKS.has(model.machine_learning_task)) errors.push(`${where}: unknown machine_learning_task ${JSON.stringify(model.machine_learning_task)}`);
    if (!Array.isArray(model.agricultural_tasks) || model.agricultural_tasks.length === 0) errors.push(`${where}: agricultural_tasks must be a non-empty array`);
    if (!Array.isArray(model.crop_types) || model.crop_types.length === 0) errors.push(`${where}: crop_types must be a non-empty array`);
    if (!isRecord(model.links) || !nonEmpty(model.links.weights)) errors.push(`${where}: links.weights (where to get the open weights) is required`);
    if (!nonEmpty(model.license)) warnings.push(`${where}: no license given — say "Not stated" explicitly`);

    // The core guarantee: nothing is presented as AgML-benchmarked unless AgML actually ran it.
    if (typeof model.agml_benchmarked !== 'boolean') errors.push(`${where}: agml_benchmarked must be true/false`);
    if (!VERIFICATIONS.has(model.verification)) errors.push(`${where}: unknown verification ${JSON.stringify(model.verification)}`);
    if ((model.verification === 'agml_verified') !== (model.agml_benchmarked === true)) {
      errors.push(`${where}: agml_benchmarked=true if and only if verification="agml_verified"`);
    }

    const datasetIds = new Set();
    for (const [dIndex, ref] of (Array.isArray(model.datasets) ? model.datasets : []).entries()) {
      const dWhere = `${where}.datasets[${dIndex}]${ref?.id ? ` (${ref.id})` : ''}`;
      if (!isRecord(ref) || !nonEmpty(ref.id)) {
        errors.push(`${dWhere}: missing id`);
        continue;
      }
      datasetIds.add(ref.id);
      if (!nonEmpty(ref.description)) warnings.push(`${dWhere}: no description — describe what it contains so users can judge fit`);
      for (const role of ref.roles ?? []) if (!DATASET_ROLES.has(role)) errors.push(`${dWhere}: unknown role ${JSON.stringify(role)}`);
      const status = ref.agml?.status;
      const names = Array.isArray(ref.agml?.names) ? ref.agml.names : [];
      if (!DATASET_STATUSES.has(status)) {
        errors.push(`${dWhere}: unknown agml.status ${JSON.stringify(status)}`);
      } else if (status === 'in_agml' || status === 'related_in_agml') {
        if (names.length === 0) errors.push(`${dWhere}: agml.status=${status} needs agml.names`);
        for (const name of names) {
          if (!agmlDatasetNames.has(name)) errors.push(`${dWhere}: agml.names references unknown AgML dataset ${JSON.stringify(name)}`);
        }
      } else if (names.length > 0) {
        errors.push(`${dWhere}: agml.names must be empty when status=${status}`);
      }
      if (status === 'not_in_agml' && !nonEmpty(ref.link)) warnings.push(`${dWhere}: dataset has no public link`);
    }

    const results = Array.isArray(model.reported_results) ? model.reported_results : [];
    if (model.verification === 'source_reported' && results.length === 0) {
      errors.push(`${where}: verification=source_reported but no reported_results`);
    }
    if (model.verification === 'no_metrics_reported' && results.length > 0) {
      errors.push(`${where}: verification=no_metrics_reported but reported_results is not empty`);
    }
    for (const [rIndex, result] of results.entries()) {
      const rWhere = `${where}.reported_results[${rIndex}]`;
      if (!isRecord(result)) {
        errors.push(`${rWhere}: not an object`);
        continue;
      }
      if (!nonEmpty(result.source_url)) errors.push(`${rWhere}: source_url is required (where the number was reported)`);
      if (!nonEmpty(result.eval_dataset) || !datasetIds.has(result.eval_dataset)) {
        errors.push(`${rWhere}: eval_dataset must match one of this model's datasets[].id`);
      }
      const metrics = isRecord(result.metrics) ? Object.entries(result.metrics) : [];
      if (metrics.length === 0) errors.push(`${rWhere}: metrics is empty`);
      for (const [key, value] of metrics) {
        if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`${rWhere}: metrics.${key} is not a number`);
        else if (value < 0 || value > 1) errors.push(`${rWhere}: metrics.${key}=${value} — store fractions in [0, 1], not percentages`);
      }
      if (result.primary_metric != null && !(isRecord(result.metrics) && result.primary_metric in result.metrics)) {
        errors.push(`${rWhere}: primary_metric ${JSON.stringify(result.primary_metric)} is not in metrics`);
      }
      if (!nonEmpty(result.split)) warnings.push(`${rWhere}: no split described`);
    }
  }
  return { errors, warnings };
}

export function loadAgmlDatasetNames(staticDataDir) {
  const names = new Set();
  for (const file of ['datasets.json', 'hf_datasets.json']) {
    const filePath = path.join(staticDataDir, file);
    if (!fs.existsSync(filePath)) continue;
    const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    for (const entry of Array.isArray(json) ? json : Object.values(json)) {
      if (entry && typeof entry.name === 'string') names.add(entry.name);
    }
  }
  return names;
}

function main() {
  const staticDataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'static', 'data');
  const modelsPath = path.join(staticDataDir, 'models.json');
  if (!fs.existsSync(modelsPath)) {
    console.log('No models.json — skipping model catalog validation');
    return;
  }
  const catalog = JSON.parse(fs.readFileSync(modelsPath, 'utf8'));
  const { errors, warnings } = validateModelCatalog(catalog, loadAgmlDatasetNames(staticDataDir));
  for (const warning of warnings) console.warn('warn:', warning);
  if (errors.length) {
    for (const error of errors) console.error('error:', error);
    console.error(`models.json: ${errors.length} error(s)`);
    process.exit(1);
  }
  console.log(`Validated ${modelsPath} — ${catalog.models.length} models, ${warnings.length} warning(s)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
